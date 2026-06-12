#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const defaultClaudeProjects = path.join(os.homedir(), ".claude", "projects");
const defaultOutRoot = path.join(os.homedir(), ".codex", "claude-handoffs");

function usage() {
  console.log(`Usage: extract-claude-transcript.mjs [options]

Extract Claude Code transcript JSONL files into handoff artifacts.

Options:
  --cwd <path>             Target repo/worktree cwd. Defaults to process.cwd().
  --project-dir <path>     Exact ~/.claude/projects/<project> directory to read.
  --claude-projects <path> Claude projects root. Defaults to ~/.claude/projects.
  --out-dir <path>         Output directory. Defaults to ~/.codex/claude-handoffs/<name>-<timestamp>.
  --list-candidates        Print matching candidate project dirs and exit.
  --no-redact              Disable common secret redaction. Use with care.
  --help, -h               Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    cwd: process.cwd(),
    projectDir: "",
    claudeProjects: defaultClaudeProjects,
    outDir: "",
    redact: true,
    listCandidates: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    } else if (a === "--cwd") {
      args.cwd = argv[++i];
    } else if (a === "--project-dir") {
      args.projectDir = argv[++i];
    } else if (a === "--claude-projects") {
      args.claudeProjects = argv[++i];
    } else if (a === "--out-dir") {
      args.outDir = argv[++i];
    } else if (a === "--list-candidates") {
      args.listCandidates = true;
    } else if (a === "--no-redact") {
      args.redact = false;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  args.cwd = path.resolve(args.cwd);
  if (args.projectDir) args.projectDir = path.resolve(args.projectDir);
  args.claudeProjects = path.resolve(args.claudeProjects);
  if (args.outDir) args.outDir = path.resolve(args.outDir);
  return args;
}

const secretPatterns = [
  [/Bearer\s+[A-Za-z0-9._~+\-\/]+=*/g, "Bearer [REDACTED]"],
  [/(sk-[A-Za-z0-9_-]{16,})/g, "[REDACTED_OPENAI_KEY]"],
  [/(xox[baprs]-[A-Za-z0-9-]+)/g, "[REDACTED_SLACK_TOKEN]"],
  [/(gh[pousr]_[A-Za-z0-9_]{20,})/g, "[REDACTED_GITHUB_TOKEN]"],
  [/(whsec_[A-Za-z0-9_]+)/g, "[REDACTED_STRIPE_WEBHOOK_SECRET]"],
  [/(rk_live_[A-Za-z0-9_]+)/g, "[REDACTED_STRIPE_RESTRICTED_KEY]"],
  [/(sk_live_[A-Za-z0-9_]+)/g, "[REDACTED_STRIPE_SECRET_KEY]"],
  [/(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/g, "[REDACTED_JWT]"],
  [/((?:password|passwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*)['"]?[^\s'",}]{6,}/gi, "$1[REDACTED]"],
];

function makeRedactor(enabled) {
  return (value) => {
    if (value == null) return "";
    let s = String(value);
    if (!enabled) return s;
    for (const [pattern, replacement] of secretPatterns) {
      s = s.replace(pattern, replacement);
    }
    return s;
  };
}

function sanitizePathForClaudeProject(p) {
  return p.replace(/[^A-Za-z0-9]/g, "-").replace(/-+/g, "-");
}

function readJsonl(file) {
  const rows = [];
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // Ignore corrupt partial lines. Claude may leave a final line incomplete.
    }
  }
  return rows;
}

function listJsonlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile());
}

function candidateDirs(args) {
  if (args.projectDir) return [args.projectDir];
  if (!fs.existsSync(args.claudeProjects)) return [];

  const dirs = fs.readdirSync(args.claudeProjects)
    .map((name) => path.join(args.claudeProjects, name))
    .filter((p) => fs.statSync(p).isDirectory());

  const exactCwd = [];
  for (const dir of dirs) {
    const files = listJsonlFiles(dir);
    let matched = false;
    for (const file of files) {
      for (const row of readJsonl(file).slice(0, 20)) {
        if (row.cwd && path.resolve(row.cwd) === args.cwd) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (matched) exactCwd.push(dir);
  }
  if (exactCwd.length) return exactCwd;

  const sanitized = sanitizePathForClaudeProject(args.cwd);
  const basename = path.basename(args.cwd);
  return dirs.filter((dir) => {
    const name = path.basename(dir);
    return name.includes(sanitized) || name.includes(basename);
  });
}

function contentText(content, redact) {
  if (typeof content === "string") return redact(content);
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part) return "";
    if (part.type === "text") return part.text || "";
    if (part.type === "fallback") {
      return `[fallback ${part.from?.model || "?"} -> ${part.to?.model || "?"}]`;
    }
    if (part.type === "tool_use") {
      return `[tool_use ${part.name}] ${JSON.stringify(part.input || {})}`;
    }
    if (part.type === "tool_result") {
      const body = typeof part.content === "string" ? part.content : JSON.stringify(part.content || "");
      return `[tool_result ${part.tool_use_id || ""}] ${body}`;
    }
    return "";
  }).filter(Boolean).map(redact).join("\n");
}

function visibleAssistantText(content, redact) {
  if (typeof content === "string") return redact(content);
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (part?.type === "text") return part.text || "";
    if (part?.type === "fallback") return `[fallback ${part.from?.model || "?"} -> ${part.to?.model || "?"}]`;
    return "";
  }).filter(Boolean).map(redact).join("\n");
}

function oneLine(value, redact, max = 180) {
  const s = redact(value).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}...` : s;
}

function defaultOutputDir(args) {
  const repoName = path.basename(args.cwd) || "claude-transcript";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(defaultOutRoot, `${repoName}-${stamp}`);
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const redact = makeRedactor(args.redact);
  const dirs = candidateDirs(args);

  if (args.listCandidates) {
    for (const dir of dirs) console.log(dir);
    return;
  }
  if (!dirs.length) {
    throw new Error(`No Claude transcript project directories found for cwd: ${args.cwd}\nTry --project-dir <path> or --list-candidates.`);
  }

  const outDir = args.outDir || defaultOutputDir(args);
  fs.mkdirSync(outDir, { recursive: true });

  const sessions = new Map();
  const rawLocations = [];
  const timeline = [];
  const assistantVisible = [];
  const userVisible = [];
  const toolUses = [];
  const toolResults = [];

  for (const dir of dirs) {
    for (const file of listJsonlFiles(dir)) {
      const stat = fs.statSync(file);
      rawLocations.push({ file, bytes: stat.size, mtime: stat.mtime.toISOString() });
      const basename = path.basename(file);
      const rows = readJsonl(file);
      for (const row of rows) {
        const sessionId = row.sessionId || row.session_id || basename.replace(/\.jsonl$/, "");
        if (!sessions.has(sessionId)) {
          sessions.set(sessionId, {
            sessionId,
            file: basename,
            firstTs: "",
            lastTs: "",
            cwd: row.cwd || "",
            gitBranch: row.gitBranch || "",
            assistantMessages: 0,
            userMessages: 0,
            toolUses: 0,
            toolResults: 0,
            firstUser: "",
            lastAssistant: "",
          });
        }
        const session = sessions.get(sessionId);
        if (row.timestamp) {
          if (!session.firstTs) session.firstTs = row.timestamp;
          session.lastTs = row.timestamp;
        }
        if (row.cwd) session.cwd = row.cwd;
        if (row.gitBranch) session.gitBranch = row.gitBranch;

        const content = row.message?.content;
        if (row.type === "assistant" || row.type === "user") {
          const text = contentText(content, redact);
          timeline.push({ timestamp: row.timestamp || "", sessionId, file: basename, type: row.type, role: row.message?.role || row.type, uuid: row.uuid || "", text });

          if (row.type === "assistant") {
            const visible = visibleAssistantText(content, redact);
            if (visible.trim()) {
              session.assistantMessages++;
              session.lastAssistant = oneLine(visible, redact);
              assistantVisible.push({ timestamp: row.timestamp || "", sessionId, file: basename, uuid: row.uuid || "", text: visible });
            }
            if (Array.isArray(content)) {
              for (const part of content) {
                if (part?.type === "tool_use") {
                  session.toolUses++;
                  toolUses.push({
                    timestamp: row.timestamp || "",
                    sessionId,
                    file: basename,
                    id: part.id || "",
                    name: part.name || "",
                    input: redact(JSON.stringify(part.input || {})),
                    command: redact(part.input?.command || ""),
                    description: redact(part.input?.description || ""),
                    file_path: redact(part.input?.file_path || ""),
                  });
                }
              }
            }
          } else {
            let hasToolResult = false;
            if (Array.isArray(content)) {
              for (const part of content) {
                if (part?.type === "tool_result") {
                  hasToolResult = true;
                  session.toolResults++;
                  const resultContent = typeof part.content === "string" ? part.content : JSON.stringify(part.content || "");
                  toolResults.push({ timestamp: row.timestamp || "", sessionId, file: basename, tool_use_id: part.tool_use_id || "", is_error: !!part.is_error, content: redact(resultContent) });
                }
              }
            }
            if (!hasToolResult && text.trim()) {
              session.userMessages++;
              if (!session.firstUser) session.firstUser = oneLine(text, redact);
              userVisible.push({ timestamp: row.timestamp || "", sessionId, file: basename, uuid: row.uuid || "", text });
            }
          }
        } else if (row.type === "queue-operation" || row.type === "attachment") {
          const text = redact(row.content || row.attachment?.content || JSON.stringify(row).slice(0, 2000));
          timeline.push({ timestamp: row.timestamp || "", sessionId, file: basename, type: row.type, role: "", uuid: row.uuid || "", text });
        }
      }
    }
  }

  const byTime = (a, b) => (a.timestamp || "").localeCompare(b.timestamp || "");
  const sessionRows = [...sessions.values()].sort((a, b) => (a.firstTs || "").localeCompare(b.firstTs || ""));
  const toolCounts = new Map();
  for (const tool of toolUses) toolCounts.set(tool.name, (toolCounts.get(tool.name) || 0) + 1);

  write(path.join(outDir, "raw-transcript-locations.json"), `${JSON.stringify(rawLocations.sort((a, b) => a.mtime.localeCompare(b.mtime)), null, 2)}\n`);
  write(path.join(outDir, "timeline.jsonl"), `${timeline.sort(byTime).map((event) => JSON.stringify(event)).join("\n")}\n`);
  write(path.join(outDir, "tool-uses.jsonl"), `${toolUses.sort(byTime).map((event) => JSON.stringify(event)).join("\n")}\n`);
  write(path.join(outDir, "tool-results.jsonl"), `${toolResults.sort(byTime).map((event) => JSON.stringify(event)).join("\n")}\n`);

  let assistantMd = `# Claude Code Assistant Visible Messages\n\nSource Claude project dirs:\n${dirs.map((dir) => `- \`${dir}\``).join("\n")}\n\nTarget cwd: \`${args.cwd}\`\nGenerated: ${new Date().toISOString()}\nRedaction: ${args.redact ? "enabled" : "disabled"}.\n\n`;
  for (const message of assistantVisible.sort(byTime)) {
    assistantMd += `## ${message.timestamp || "(no timestamp)"} - ${message.sessionId}\n\n${message.text.trim() || "(empty)"}\n\n`;
  }
  write(path.join(outDir, "assistant-visible-messages.md"), assistantMd);

  let userMd = `# Claude Code User Visible Messages\n\nTarget cwd: \`${args.cwd}\`\nGenerated: ${new Date().toISOString()}\nTool results are excluded; see \`tool-results.jsonl\`.\n\n`;
  for (const message of userVisible.sort(byTime)) {
    userMd += `## ${message.timestamp || "(no timestamp)"} - ${message.sessionId}\n\n${message.text.trim() || "(empty)"}\n\n`;
  }
  write(path.join(outDir, "user-visible-messages.md"), userMd);

  let toolsTsv = "timestamp\tsessionId\ttool\tdescription\tcommand\tfile_path\tinput_json\n";
  for (const tool of toolUses.sort(byTime)) {
    const cells = [tool.timestamp, tool.sessionId, tool.name, tool.description, tool.command, tool.file_path, tool.input]
      .map((value) => String(value || "").replace(/\t/g, " ").replace(/\r?\n/g, "\\n"));
    toolsTsv += `${cells.join("\t")}\n`;
  }
  write(path.join(outDir, "tool-uses.tsv"), toolsTsv);

  let summary = "# Claude Code Handoff Extract\n\n";
  summary += `- Generated: ${new Date().toISOString()}\n`;
  summary += `- Target cwd: \`${args.cwd}\`\n`;
  summary += `- Claude project dirs: ${dirs.length}\n`;
  for (const dir of dirs) summary += `  - \`${dir}\`\n`;
  summary += `- Sessions: ${sessionRows.length}\n`;
  summary += `- Assistant visible message blocks: ${assistantVisible.length}\n`;
  summary += `- User visible message blocks: ${userVisible.length}\n`;
  summary += `- Tool uses: ${toolUses.length}\n`;
  summary += `- Tool results: ${toolResults.length}\n`;
  summary += `- Redaction: ${args.redact ? "enabled" : "disabled"}\n\n`;
  summary += "## Tool Counts\n\n";
  for (const [name, count] of [...toolCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    summary += `- ${name}: ${count}\n`;
  }
  summary += "\n## Sessions\n\n";
  for (const session of sessionRows) {
    summary += `### ${session.sessionId}\n\n`;
    summary += `- File: \`${session.file}\`\n`;
    summary += `- Time: ${session.firstTs || "?"} to ${session.lastTs || "?"}\n`;
    summary += `- CWD: \`${session.cwd || "?"}\`\n`;
    summary += `- Branch: \`${session.gitBranch || "?"}\`\n`;
    summary += `- Assistant/user/tool/tool-result blocks: ${session.assistantMessages}/${session.userMessages}/${session.toolUses}/${session.toolResults}\n`;
    if (session.firstUser) summary += `- First user: ${session.firstUser}\n`;
    if (session.lastAssistant) summary += `- Last assistant: ${session.lastAssistant}\n`;
    summary += "\n";
  }
  summary += "## Files Written\n\n";
  for (const name of ["summary.md", "assistant-visible-messages.md", "user-visible-messages.md", "tool-uses.tsv", "tool-uses.jsonl", "tool-results.jsonl", "timeline.jsonl", "raw-transcript-locations.json"]) {
    summary += `- \`${path.join(outDir, name)}\`\n`;
  }
  write(path.join(outDir, "summary.md"), summary);

  console.log(outDir);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
