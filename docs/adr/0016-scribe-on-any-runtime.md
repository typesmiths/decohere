# 0016. Scribe runs on any runtime with a `console`; writers are adapter packages

- **Status:** Proposed
- **Date:** 2026-10-26 · updated 2026-11-10

## Context

A Cloudflare Workers + Svelte project could not log through `@decohere/scribe`. The facade has no dependencies, but it read `process.env` and wrote its missing-adapter warning with `process.stderr.write`, so `configure()` threw `process is not defined` in a browser. The only structured writer, `@decohere/scribe-pino`, needs Node. The project kept its own copy of scribe, plus errors with causes, an error-reporter hook, bound context, deeper redaction and a test double. It also wanted redaction at any depth in every adapter and masking values by pattern.

## Decision

- **The facade uses only the language and `console`:** `JSON`, `Proxy`, `queueMicrotask`, and `console` from the Console Standard, which browsers, Node, Deno, Bun, Workers and React Native implement. An engine without `console` must configure its own adapter. The facade reads the environment through `globalThis.process?.env` and warns with `console.warn`: no `node:` imports, no bare `process.`, no `Buffer`. `projects/scribe/scribe/tests/runtime.portability.spec.ts` checks the facade and `@decohere/scribe-console` for these.
- **The facade implements no logger.** Writers are adapter packages the app chooses: `@decohere/scribe-pino` for Node, `@decohere/scribe-console` (one JSON line per entry through the console method of its level) anywhere. The built-in `ConsoleAdapter` stays as the fallback for scripts.
- **One entry shape:** `LogEntry` is `{ level, name, msg, err, fields }`, built by `logEntry.from` under the [argument rules](../../projects/scribe/README.md#argument-rules). Structured adapters subclass `LogEntryAdapter` and only write entries.
- **Errors are plain objects:** `serializeError` gives `{ name, message, stack, cause, ...own properties }`, following causes three levels deep.
- **`child(fields)` is part of `Logger`.** A child of a `scribe.logger(...)` handle is live like its parent: it follows a later `configure`.
- **Context comes from the host.** `scribe.addContextSource(source)` binds what `source()` returns to every line, like `child`. Scribe keeps no context of its own: `@decohere/http` holds the request in Node's `AsyncLocalStorage` and is the source, so the facade stays free of `node:async_hooks`.
- **Taps see what is written.** `configure({ tap })` receives every entry a `scribe.logger(...)` handle writes at an enabled level, as logged. A tap that throws does not break the logging call; its error is rethrown on a microtask, so the runtime reports it as uncaught.
- **Scribe does not redact; adapters do.** The facade passes `redactions` to the adapter and censors nothing itself, not even for the tap. `PinoAdapter` hands them to Pino's `redact`; the console adapters censor the keys at any depth. Masking by pattern is the app's to write, in its adapter or the provider's options.
- **The test double ships with the facade:** `CaptureAdapter` in `@decohere/scribe/testing` keeps entries and prints nothing.

## Consequences

- Workers, browsers, Deno and Bun can use the facade and `@decohere/scribe-console` as published. Node apps keep Pino.
- Pino's write path is unchanged. Pino censors only what its `redact` paths reach, so a nested key is censored only if the app gives Pino that path.
- A tap gets entries unredacted; one that sends them out of the process (to Sentry, say) must scrub them first.
- Under Node a throwing tap ends the process through `uncaughtException`, like any uncaught error. A tap that may fail catches its own errors. We chose that over swallowing the error.

## History

- 2026-10-26: Decided.
- 2026-11-04: Dropped the note that packages publish private-first: first publishes are `--access public`, and only the stable 0.1.0 release is pending ([ADR 0003](0003-no-changesets-until-public-release.md)).
- 2026-11-10: Added context sources, so a request's id reaches every line without the facade depending on Node.
