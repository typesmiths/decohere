# 0009. Agent instructions live in AGENTS.md, for any agent

- **Status:** Proposed
- **Date:** 2026-10-14

## Context

An earlier change made Claude the only configured agent, with its instructions in `CLAUDE.md`, and deleted the Cursor and Copilot files: instructions spread across five files had drifted apart. That fixed the drift, but only Claude Code reads `CLAUDE.md`, and we may use other agents. `AGENTS.md` is the file most of them read (Codex, Cursor, Copilot, Gemini and others). Claude Code reads `CLAUDE.md` and follows `@path` imports in it.

## Decision

- **One instructions file, `AGENTS.md`, at the repo root**, written for any agent: commands, hard rules, workflow, working rules, and links to `docs/`. It points at the docs rather than restating them.
- **`CLAUDE.md` is one line, `@AGENTS.md`**, so Claude Code reads the same file. Other agents that need a file of their own get a pointer like it, never a copy.
- **Per-agent settings that are not instructions stay per agent**, for example `.claude/settings.json` (commands Claude Code may run without asking).
- **Agent working files are ignored**: `.claude/worktrees/` is in `.gitignore`.

## Consequences

- Any agent picks up the same rules, and there is still one file to keep current.
- Agent-specific instructions (rules files, per-tool folders) are not added; if an agent cannot read `AGENTS.md` it gets a one-line pointer.
- We rely on Claude Code's `@` import. If it ever stops following it, `CLAUDE.md` would load as a bare reference and Claude would start without instructions.

## History

- 2026-10-03: Claude only, one `CLAUDE.md`; other agent files removed.
- 2026-10-14: The instructions move to `AGENTS.md` so any agent reads them; `CLAUDE.md` imports it.
