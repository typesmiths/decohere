# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue or pull request.

Use **[Report a vulnerability](https://github.com/typesmiths/decohere/security/advisories/new)** on the repository's Security tab. Only the maintainers see the report. Include what is affected (package and version), how to reproduce it, and what an attacker could do with it.

We aim to acknowledge a report within a few days, and to agree on a fix and a disclosure date with you before anything is made public. Once a fix ships, we publish a GitHub security advisory and credit you unless you'd rather not be named.

## Supported versions

Decohere is pre-1.0. Fixes land on `main` and ship in the next `@decohere/*` release; older versions are not patched. Upgrade to the latest version to get them.

## Scope

In scope: the `@decohere/*` packages on npm, the `ghcr.io/typesmiths/decohere/*` images, and the apps `@decohere/create` scaffolds, as generated.

Out of scope: vulnerabilities in dependencies that are already public (report them upstream; Dependabot tracks them here), and issues that need an attacker who already controls your machine or your build.
