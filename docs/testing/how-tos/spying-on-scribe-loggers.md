# Spying on Scribe Loggers in Tests

## Problem

You want to assert that a logger method (`error`, `warn`, etc.) was called — or called exactly once — in a test. The naive approaches fail:

- **`vi.spyOn(process.stderr, "write")`** — pino-pretty writes formatted text, not JSON, so filtering by `'"level":50'` never matches.
- **`vi.spyOn(console, "error")`** — scribe's default console adapter uses `console.log` for all log levels, not `console.error`.
- **`vi.mock("@decohere/scribe", ...)`** — Vitest mocks by the resolved module path, not the tsconfig alias. The mock never intercepts because `@decohere/scribe` resolves to a different ID than what the source module loaded.

## Preferred Solution: Configure a `CaptureAdapter`

`@decohere/scribe/testing` ships `CaptureAdapter`: it keeps every entry that passes the level as a `LogEntry` (`{ level, name, msg, err, fields }`, with the `redactions` keys censored) and prints nothing. No spies, no mocks, and it works whichever module created the logger, because `scribe.logger(...)` handles follow `configure`:

```typescript
import { scribe } from "@decohere/scribe";
import { CaptureAdapter } from "@decohere/scribe/testing";

const capture = new CaptureAdapter();

beforeEach(() => {
    capture.clear();
    scribe.configure({ adapter: capture, options: { logLevel: "trace" } });
});

it("reports the failed charge once", async () => {
    await checkout.run();

    expect(capture.at("error")).toHaveLength(1);
    expect(capture.at("error")[0]).toMatchObject({ msg: "charge failed", fields: { orderId: 7 } });
});
```

Use the spy below only when the code under test holds a logger that did not come from `scribe.logger(...)`.

## Alternative: Spy directly on `scribe.logger` via the real resolved path

Import `scribe` using its real path (not the tsconfig alias), spy on `scribe.logger` in `beforeEach` to return a shared mock logger, then assert on its methods:

```typescript
// Use the real resolved path, not the @decohere/scribe alias
import { scribe } from "../../scribe/scribe/src/logger.factory.js";

describe("logging", () => {
    const mockLogger = { info: vi.fn(), warn: vi.fn(), trace: vi.fn() };

    beforeEach(() => {
        vi.spyOn(scribe, "logger").mockReturnValue(mockLogger as never);
    });

    it("logs with module id prefix", async () => {
        const app = await RootModule.create([MyModule]);
        await app.run(["my-module"]);

        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/my-module\//));
    });
});
```

The spy must be set up in `beforeEach` so it's active before any class that calls `scribe.logger()` is instantiated (field initializers run at construction time). `vi.restoreAllMocks()` in the outer `beforeEach` ensures cleanup between tests.

## Why the alias doesn't work

Vitest resolves `@decohere/scribe` to a different module instance than what the source under test loaded. The spy on the alias never intercepts calls made through the resolved path.

---

## Alternative: Separate environment setup from logic

The cleanest approach requires no mocks at all. The key insight: **pino is only configured when `configureLogger()` is called**. If the module under test never calls it, scribe uses its default console adapter — which writes to `console.log`.

### Step 1: Keep `configureLogger()` in the entry point only

```typescript
// cli.ts (entry point — not imported in tests)
configureLogger();  // ← pino setup stays here
await run();
```

```typescript
// run.ts (the module tests import)
export async function run() {
    const logger = scribe.logger("Forge");  // ← uses default adapter in tests
    // ...
}
```

### Step 2: Spy on `console.log` and filter by level name

Scribe's console adapter formats log lines as `[timestamp] LEVEL [name]: message`. Filter by `" ERROR "`:

```typescript
const consoleSpy = vi.spyOn(console, "log");

const { run } = await import("../../src/cli/run.js");
await run();

const errorLines = (consoleSpy.mock.calls as [string][])
    .map(([msg]) => msg)
    .filter((msg) => msg?.includes(" ERROR "));
expect(errorLines).toHaveLength(1);
```

No mocks for scribe, no mocks for logger factory — just a spy on `console.log` with a level filter.

## Alternative: Mock the logger factory

If pino *must* be configured before tests (e.g. the module calls `configureLogger()` internally), mock the factory module and intercept the returned logger:

```typescript
// tests/helpers/mock-logger.ts
export const mockLogger = { error: vi.fn(), info: vi.fn(), /* ... */ };

// test file
vi.mock("../../src/factories/logger.factory.js", () => ({
    configureLogger: () => () => mockLogger,
}));

expect(mockLogger.error).toHaveBeenCalledTimes(1);
```

The mock path must be **relative to the test file** — tsconfig aliases are not resolved by Vitest's mock registry.

## Why not spy on `scribe.logger` directly?

You can, but only using the **actual resolved path**, not the alias:

```typescript
// Works — real resolved path
import { scribe } from "../../../../scribe/scribe/src/index.js";
vi.spyOn(scribe, "logger").mockReturnValue(mockLogger as never);

// Does NOT work — alias resolves to a different module instance
import { scribe } from "@decohere/scribe";
```

## Why not use `__mocks__`?

`vi.mock()` is hoisted statically at compile time and must appear in the test file. It cannot be called at runtime from a helper function. The mock logger object itself can live in a shared helper (`tests/helpers/mock-logger.ts`) since `vi.clearAllMocks()` resets call counts on the shared instance between tests.
