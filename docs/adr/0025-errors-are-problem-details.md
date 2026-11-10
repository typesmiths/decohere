# 0025. `@decohere/http` answers every error as an RFC 9457 problem

- **Status:** Proposed
- **Date:** 2026-11-10

## Context

Error bodies had three shapes: `{ statusCode, error, message, errors }` for validation, `{ message }` for every other `HttpError`, and Fastify's own `{ message, error, statusCode }` for an unknown route or a body it rejected before a handler. A client had to know which one it would get. A domain error had no way to say what kind of problem it was beyond a status and a message. RFC 9457 (`application/problem+json`) is the standard shape for this, and API tooling already understands it.

## Decision

- **One shape.** The default exception filter and `FastifyProvider`'s not-found and error handlers send `{ type, title, status, detail?, ...extensions }` with `Content-Type: application/problem+json`. `type` is `about:blank` unless the error names one; `title` defaults to the status text; `detail` is the error's message, left out when it only repeats the title.
- **Domain errors subclass `HttpError`** and pass `{ type, title, extensions }` as its third argument. Extensions can't replace the standard members.
- **Validation keeps `errors`** as an extension member: `[{ path, message, keyword }]`.
- **Nothing leaks.** A `401` and a `500` send no `detail` and no extensions; the message is logged. Any error that isn't an `HttpError` is a `500`. Fastify's 4xx messages (bad JSON, body too large, rate limit) are sent as `detail`; its 5xx are logged and hidden.
- **`problemDetails.create` and `problemDetails.toResult`** are exported so a custom exception filter answers in the same shape.
- **A UI served from the root keeps its own not-found handler** (it falls back to the app), and answers the same 404 problem when it doesn't fall back ([ADR 0007](0007-serving-a-built-ui-from-http.md)).

## Consequences

- A client reads `status`, `title` and `detail` for any error, and branches on `type` for domain errors.
- Breaking for clients that read `message`, `statusCode` or `error`: they read `detail`, `status` and `title` instead. Decohere is before 1.0, so this ships without a deprecation period.
- Not done: `instance` (left to the app, for example a request id once requests carry one), localised titles, and problem schemas in the OpenAPI document.

## History

- 2026-11-10: Decided.
