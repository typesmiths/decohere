# 0016. Scribe runs on any runtime with a `console`; writers are adapter packages

- **Status:** Proposed
- **Date:** 2026-10-26

## Context

A Cloudflare Workers + Svelte project wanted to log through `@decohere/scribe` and couldn't. The facade has no dependencies, but it read `process.env` and wrote its missing-adapter warning with `process.stderr.write`, so `configure()` threw `process is not defined` in a browser. The only writer that produced structured lines was `@decohere/scribe-pino`, which needs Node. The project ended up keeping its own copy of scribe, plus what it needed on top: errors with their causes, a hook for an error reporter, bound context, deeper redaction and a test double. The issue also asked for redaction at any depth in every adapter and for masking values by pattern.

## Decision

- **The facade uses only the language and `console`:** `JSON`, `Proxy`, `queueMicrotask`, and `console` from the Console Standard, which browsers, Node, Deno, Bun, Workers and React Native implement. A bare embedded engine without `console` must configure its own adapter. It reads the environment through `globalThis.process?.env`, and warns with `console.warn`. No `node:` imports, no `process.` without `globalThis.`, no `Buffer`. `tests/runtime.portability.spec.ts` checks the facade and `@decohere/scribe-console` for these.
- **The facade still implements no logger.** Every writer is an adapter package the app chooses: `@decohere/scribe-pino` for Node, `@decohere/scribe-console` for one JSON line per entry through the console method of its level, which works anywhere. The built-in `ConsoleAdapter` stays as the fallback for scripts.
- **One entry shape:** `LogEntry` is `{ level, name, msg, err, fields }`, built from a log call's arguments by `logEntry.from` under the rules in the [Scribe README](../../projects/scribe/README.md#argument-rules). Structured adapters subclass `LogEntryAdapter` and only write entries.
- **Errors are plain objects:** `serializeError` gives `{ name, message, stack, cause, ...own properties }`, following `Error` causes three levels deep.
- **`child(fields)` is part of `Logger`.** A child of a `scribe.logger(...)` handle is live, like its parent: it follows a later `configure`.
- **Taps see what is written.** `configure({ tap })` is called with every entry a `scribe.logger(...)` handle writes at an enabled level, as it was logged. A tap that throws doesn't break the call that logged. Its error isn't swallowed either: it is rethrown on a microtask, so the runtime reports it as uncaught.
- **Scribe doesn't redact; adapters do, or the provider behind them.** The facade hands `redactions` to the adapter and doesn't censor anything itself, not even what it gives the tap. `PinoAdapter` passes them to Pino's own `redact`; the console adapters censor the keys at any depth. Custom redaction, such as masking values by pattern, is the app's to write, in its own adapter or the provider's options.
- **The test double ships with the facade:** `CaptureAdapter` in `@decohere/scribe/testing` keeps entries and prints nothing.

## Consequences

- Workers, browsers, Deno and Bun can use the facade and `@decohere/scribe-console` as published. Node apps keep Pino.
- Pino's write path is unchanged: no extra pass over each line. What Pino censors is what Pino's `redact` reaches, so a key two levels down isn't censored unless the app gives Pino that path.
- A tap gets entries as logged. A tap that sends them out of the process (to Sentry, say) has to scrub them first.
- Redaction at any depth in every adapter, masking by pattern is left to adapters and apps on purpose.
- A tap that throws under Node ends the process through `uncaughtException`, as any uncaught error does. A tap that may fail must catch its own errors. We chose that over swallowing the error.
- `@decohere/scribe-console` is a new npm name: like any new package it needs a first publish and a Trusted Publisher before `publish.yml` can release it.
- Not done here: making the scribe packages public on npm. Every package is still published private-first; going public is the first public release ([ADR 0003](0003-no-changesets-until-public-release.md)), and that is its own decision.

## History

- 2026-10-26: Decided.
