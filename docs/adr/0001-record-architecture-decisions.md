# 0001. Record architecture decisions in `docs/adr/`, one record per topic

- **Status:** Accepted
- **Date:** 2026-08-22 · updated 2026-11-03

## Context

`docs/architecture/` and `docs/style/` say **what** to do. They keep no dated record of **why**, or of the alternatives we rejected. That lived in chat, PR bodies and trackers, where it gets lost and argued again.

One record per decision, with each change a new record superseding an old one, gets hard to use. An earlier project reached 100 records that way; finding what held today meant following chains like 0060 → 0064 → 0066 → 0068 → 0070, and it had to merge them into 37.

## Decision

Keep Architecture Decision Records in `docs/adr/`, **one record per topic**, from [template.md](template.md), indexed by area in [README.md](README.md).

- A record says **what holds today**: Context, Decision, Consequences. It ends with a dated **History**, one line per change saying what changed and why.
- **Changing a decision means updating its record** in the same PR as the code: rewrite what no longer holds, add a History line, bump _updated_. Never a quiet edit.
- **A new topic gets a new record** with the next unused number. Numbers are never reused.
- When topics drift together, merge them. The earliest record still in force keeps its number, the others are deleted, and its **Merges** line lists the old numbers.
- When a decision changes a standing rule, update `docs/architecture/` or `docs/style/` in the same PR. Those hold the rule; an ADR is the why, not a second spec.
- `AGENTS.md` links each hard rule to the record that explains it.
- A record stands on its own: no issue or PR numbers. The PR that changes a record links its issue.

## Consequences

- Before changing how something works, read one record to know where things stand, then update it.
- PRs can point at an ADR instead of restating the argument.
- Records grow, so split one when it passes about two pages.
- Old ADR numbers in git history can point at deleted files; the **Merges** line says where they went.
- How-tos stay in `docs/testing/how-tos/`. An ADR is not a tutorial.
- Nothing checks that a PR updated the right record; that rests on the PR template and on review.

## History

- 2026-08-22: One file per decision in `docs/adr/`, indexed from the README.
- 2026-10-11: One record per topic, each ending in a History, updated in the same PR as the code; merged records leave a **Merges** line.
- 2026-10-14: The agent instructions that link the hard rules moved from `CLAUDE.md` to `AGENTS.md` ([ADR 0009](0009-agent-instructions-in-agents-md.md)).
- 2026-11-03: Records carry no issue or PR numbers and the `Issue` field is gone: the repo restarted without its old tracker, and the code, not the tracker, is the source of truth.
