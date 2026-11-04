# 0009. Agent instructions live in AGENTS.md, for any agent

- **Status:** Proposed
- **Date:** 2026-10-14 · updated 2026-11-03

## Context

Instructions spread across several agent-specific files drifted apart, so they were collapsed into one `CLAUDE.md`. But only Claude Code reads `CLAUDE.md`. `AGENTS.md` is the file most other agents read (Codex, Cursor, Copilot, Gemini). Claude Code follows `@path` imports in `CLAUDE.md`.

## Decision

- **One instructions file, `AGENTS.md`, at the repo root**, for any agent: commands, hard rules, workflow, working rules, links into `docs/`. It points at the docs rather than restating them.
- **`.claude/CLAUDE.md` is one line, `@../AGENTS.md`.** Another agent that needs its own file gets a pointer like it, never a copy.
- **Per-agent settings that are not instructions stay per agent**, e.g. `.claude/settings.json`.
- **Agent working files are ignored**: `.claude/worktrees/` is in `.gitignore`.

## Consequences

- Every agent gets the same rules from one file.
- No agent-specific rules files or folders.
- We rely on Claude Code's `@` import. If it stopped following it, Claude would start without instructions.

## History

- 2026-10-03: Claude only, one `CLAUDE.md`; other agent files removed.
- 2026-10-14: The instructions move to `AGENTS.md` so any agent reads them; `CLAUDE.md` imports it.
- 2026-11-03: The pointer moves to `.claude/CLAUDE.md`, which Claude Code also reads, to keep the root to files tools need there.
