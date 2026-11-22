# Docs

Two audiences, two folders. Pick the one that fits what you're doing.

| You are | Start at | What's there |
|---|---|---|
| **Using Decohere**: building an app or a tool with its packages | [guide/](guide/) | Why Decohere, getting started, recipes, and each package's README for its options |
| **Working on Decohere**: changing this repo, as a person or a coding agent | [contributing/](contributing/) | Set up and workflow, architecture, code style, testing, CI and release, decisions (ADRs) |

The [README](../README.md) is the product landing page. Coding agents start at [AGENTS.md](../AGENTS.md).

## Package READMEs

Each package's `README.md` serves both audiences, in that order: how to use the package first, then a last section, **Working on this package**, for contributors (how it's laid out and tested). Packages that only build Decohere itself, such as `ci-tools` and `devkit`, say so at the top. The list of packages is in [architecture](contributing/architecture/#packages).

## Where a new page goes

| Writing | For | Goes in |
|---|---|---|
| How to do something with Decohere in an app | users | [guide/recipes/](guide/recipes/) |
| A package's options and API | users | that package's README, above **Working on this package** |
| How a package is built or tested | contributors | that package's README, under **Working on this package** |
| A rule, process or how-to for this repo | contributors | its page in [contributing/](contributing/) |
| A lasting decision | contributors | [contributing/adr/](contributing/adr/) |

A page is written for one audience. If users need part of a contributor page, it moves to the guide and the contributor page links to it, not the other way round.
