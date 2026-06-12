---
name: cc-handoff
description: Extract and summarize Claude Code conversation history from local transcript JSONL files, including chat-visible assistant/user messages, tool uses, tool results, session metadata, cwd, and git branch. Use when the user asks to recover, hand off, audit, or inspect what Claude Code did in a branch, worktree, repo, or previous session.
---

# CC Handoff

## Overview

Use this skill to recover Claude Code conversation history from local `~/.claude/projects/**.jsonl` transcript files and convert it into handoff artifacts that another agent or human can inspect.

The bundled script extracts chat-visible assistant/user text, tool calls, tool results, session summaries, raw transcript locations, timestamps, `cwd`, and `gitBranch`. It redacts common bearer tokens, JWTs, API keys, and secret-like assignments by default.

## Quick Start

Run from the repo or worktree you want to investigate:

```bash
node /path/to/cc-handoff/scripts/extract-claude-transcript.mjs
```

Useful options:

```bash
# Explicit target worktree/repo path
node scripts/extract-claude-transcript.mjs --cwd /path/to/worktree

# Use an exact Claude transcript project directory
node scripts/extract-claude-transcript.mjs --project-dir ~/.claude/projects/-Users-example-repo

# Choose an output directory
node scripts/extract-claude-transcript.mjs --out-dir ./handoff

# List candidate Claude project dirs without extracting
node scripts/extract-claude-transcript.mjs --list-candidates --cwd /path/to/worktree
```

## Workflow

1. Identify the target `cwd`.
   - Default to the current working directory.
   - If the user names a branch or worktree, run from that worktree or pass `--cwd`.

2. Run `scripts/extract-claude-transcript.mjs`.
   - Prefer the default redacted output.
   - Use `--no-redact` only when the user explicitly asks for raw output and understands the secret exposure risk.

3. Inspect `summary.md` first.
   - It lists session count, tool counts, session IDs, first user message, last assistant message, and written files.

4. Use the detailed artifacts as needed:
   - `assistant-visible-messages.md`: assistant text shown in Claude Code chat.
   - `user-visible-messages.md`: user prompts, excluding tool-result pseudo-user entries.
   - `tool-uses.tsv`: spreadsheet-friendly tool call list.
   - `tool-uses.jsonl`: machine-readable tool call details.
   - `tool-results.jsonl`: redacted tool outputs.
   - `timeline.jsonl`: unified chronological event stream.
   - `raw-transcript-locations.json`: original transcript file paths.

5. Ground the handoff against Git.
   - Run `git status --short --branch`, `git log --oneline -n 10`, and relevant PR/Issue checks separately.
   - Treat transcript claims as history, not proof of current repository state.

## Safety

- Do not commit extracted transcript artifacts unless the user explicitly asks. They may contain sensitive code paths, prompts, tool outputs, or secrets that redaction missed.
- Keep handoff output outside the repo by default.
- Make clear that Claude internal reasoning is not reliably recoverable. The script extracts persisted transcript fields and chat-visible text, not private model state.
- If the user asks for "everything", provide raw transcript locations and redacted structured artifacts rather than pasting huge logs into chat.

## Script Notes

The script intentionally avoids requiring Claude Code or network access. It reads local JSONL transcript files only.

Auto-discovery order:

1. Exact `--project-dir`, if provided.
2. Claude project directories whose transcript entries have `cwd` equal to `--cwd`.
3. Claude project directory names that contain a sanitized form of `--cwd`.
4. If nothing matches, list likely candidates and ask the user for `--project-dir`.
