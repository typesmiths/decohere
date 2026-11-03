# 0001. Record architecture decisions in `docs/adr/`, one record per topic

- **Status:** Accepted
- **Date:** 2026-08-22 · updated 2026-11-03

## Context

Architecture and style rules live in `docs/architecture/` and `docs/style/`. Those files say **what** to do. They do not keep a dated record of **why**, or of alternatives we rejected. That history was living in chat, PR bodies, and task trackers — easy to lose and easy to re-litigate.

We already have a docs tree with one folder per concern (`architecture`, `style`, `testing`, `contributing`, `ci`, `ai`). Testing how-tos sit under `docs/testing/how-tos/`. Decisions need the same kind of home, next to that tree, not mixed into the how-tos or into agent shims.

Records that are one decision each, with every change added as a new record that supersedes an old one, get hard to use. The battersea-cougars/ark project reached 100 records this way, and finding what held today meant following chains like 0060 → 0064 → 0066 → 0068 → 0070. It had to merge them into 37.

## Decision

Keep Architecture Decision Records in `docs/adr/`, **one record per topic**, using [template.md](template.md) and indexed from [README.md](README.md) by area.

- A record says **what holds today**: Context, Decision, Consequences. It ends with a dated **History**, one line per change, saying what changed and why.
- **Changing a decision means updating its topic's record**, in the same PR as the code: rewrite the parts that no longer hold, add a History line, bump _updated_. Never a quiet edit.
- **A new topic gets a new record** with the next unused number. Numbers are never reused.
- When topics drift together, merge them. The earliest record still in force keeps its number, the others are deleted, and its **Merges** line lists the old numbers.
- When a decision changes a standing rule, update `docs/architecture/` or `docs/style/` in the same PR. Those stay the current rule; an ADR is the why, not a second spec.
- `AGENTS.md` links the rules agents must not break to the record that explains each.
- A record stands on its own: no issue or PR numbers, in the header or in History lines. The PR that changes a record links its issue.

## Consequences

- Anyone, human or agent, about to change how something works reads one record per topic and knows where things stand, then updates that record.
- Later PRs can point at an ADR instead of restating the argument.
- Records get longer over time, so they must be split when they pass about two pages.
- Old ADR numbers in git history and GitHub issues can point at deleted files. The **Merges** line is how to find where they went.
- How-tos stay in `docs/testing/how-tos/` — an ADR is not a tutorial.
- Nothing checks that a PR updated the right record; that rests on the PR template's prompt and on review.

## History

- 2026-08-22: One file per decision in `docs/adr/`, indexed from the README.
- 2026-10-11: One record per topic, each ending in a History, updated in the same PR as the code; merged records leave a **Merges** line. Adopted from battersea-cougars/ark.
- 2026-10-14: The agent instructions that link the hard rules moved from `CLAUDE.md` to `AGENTS.md` ([ADR 0009](0009-agent-instructions-in-agents-md.md)).
- 2026-11-03: Records carry no issue or PR numbers; the `Issue` field is gone. The repo was restarting without its old tracker, where those numbers led nowhere, and the code, not the tracker, is the source of truth.
