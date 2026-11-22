# Asserting Scribe logs

To check what code logged, capture the entries instead of spying on `console` or `process.stderr`: the console adapter writes every level with `console.log`, and pino-pretty writes formatted text, not JSON.

## Pattern: `CaptureAdapter`

`CaptureAdapter` from `@decohere/scribe/testing` keeps each entry that passes the level as a `LogEntry` (`{ level, name, msg, err, fields }`) and prints nothing. Loggers from `scribe.logger(...)` follow `scribe.configure`, so it works whichever module created the logger.

```ts
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

All entries are in `capture.entries`. Examples: `projects/scribe/scribe/tests/scribe.integration.spec.ts`.

## Alternative: spy on `scribe.logger`

To assert the exact arguments of one call, return a mock logger from `scribe.logger`:

```ts
import { scribe } from "@decohere/scribe";
import { createMockLogger } from "@decohere/testing";

const logger = createMockLogger();
vi.spyOn(scribe, "logger").mockReturnValue(logger);

const action = new SyncDependencies(workspace, resolver);
await action.run({ configuration: Release.name, logDiff: true });

expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("@MOCK_ORG/MOCK_APP1"), expect.anything());
```

Similar to `projects/forge/tests/actions/dependency-sync.action.spec.ts`.

## Pitfalls

- Set the spy before the code under test calls `scribe.logger()`. A class that gets its logger in a field initializer gets it when constructed.
- `createMockLogger().child()` returns the same mock, so calls on a child are asserted on the parent.
- Restore spies (`vi.restoreAllMocks()`) after each test.
