# Claude Transcript Handoff Skill

Extract Claude Code conversation history from local transcript files and turn it into handoff artifacts for another agent or human.

This skill is useful when you want to answer questions like:

- What did Claude Code do in this branch?
- What chat messages were shown, not just file edits?
- Which tools did Claude Code run?
- Where are the original transcript files?
- How can I hand off a long Claude Code session to Codex, another Claude Code session, or a teammate?

## What It Extracts

The bundled script reads Claude Code transcript JSONL files under `~/.claude/projects/` and writes:

- `summary.md`: session summaries, tool counts, first/last messages, output file list
- `assistant-visible-messages.md`: assistant messages shown in Claude Code chat
- `user-visible-messages.md`: user prompts, excluding tool-result pseudo-user entries
- `tool-uses.tsv`: spreadsheet-friendly tool call list
- `tool-uses.jsonl`: machine-readable tool calls
- `tool-results.jsonl`: redacted tool outputs
- `timeline.jsonl`: chronological event stream
- `raw-transcript-locations.json`: source transcript file paths

Common bearer tokens, JWTs, API keys, and secret-like assignments are redacted by default.

## Install

Install with the Vercel Labs Skills CLI:

```bash
npx skills add nanameru/claude-transcript-handoff-skill --skill claude-transcript-handoff -g -a codex -a claude-code -y
```

List the skill without installing:

```bash
npx skills add nanameru/claude-transcript-handoff-skill --list
```

## Use

After installing, ask your agent to use `$claude-transcript-handoff`.

You can also run the script directly:

```bash
node skills/claude-transcript-handoff/scripts/extract-claude-transcript.mjs
```

Run against a specific worktree:

```bash
node skills/claude-transcript-handoff/scripts/extract-claude-transcript.mjs \
  --cwd /path/to/worktree
```

Choose an output directory:

```bash
node skills/claude-transcript-handoff/scripts/extract-claude-transcript.mjs \
  --cwd /path/to/worktree \
  --out-dir ./handoff
```

List candidate Claude project directories:

```bash
node skills/claude-transcript-handoff/scripts/extract-claude-transcript.mjs \
  --cwd /path/to/worktree \
  --list-candidates
```

## Safety Notes

Transcript files can include sensitive prompts, command output, file paths, and secrets. Redaction is best-effort, not a guarantee.

Avoid committing generated handoff files unless you have reviewed them and explicitly intend to publish them.

This extracts persisted transcript fields and chat-visible text. It does not recover private model reasoning or anything that Claude Code did not save to transcript files.

## Requirements

- Node.js 18+
- Local Claude Code transcript files under `~/.claude/projects/`
- Optional: `npx skills` for installation into supported coding agents

## Repository Layout

```text
skills/
  claude-transcript-handoff/
    SKILL.md
    agents/openai.yaml
    scripts/extract-claude-transcript.mjs
```
