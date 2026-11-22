# Scribe

Logger facade and Pino binding for Decohere.

| Package | Path | Role |
|---|---|---|
| [`@decohere/scribe`](./scribe) | `projects/scribe/scribe` | Zero-dep facade — `scribe.logger(name)` |
| [`@decohere/scribe-pino`](./scribe-pino) | `projects/scribe/scribe-pino` | Pino writer, with pretty lines and rolling files (Node) |
| [`@decohere/scribe-console`](./scribe-console) | `projects/scribe/scribe-console` | JSON console adapter (Workers, browsers, Deno, Bun, Node) |

Application and library code call `scribe.logger(name)`; a separate adapter owns the concrete writer (console by default, Pino via `@decohere/scribe-pino`, JSON lines via `@decohere/scribe-console`, or your own). Configuration of transports, pretty printers, and file rotation lives in the adapter (or in the app composition root) — not in domain packages.

## Why a facade?

Coupling every module to a concrete logger looks convenient until you change providers. Every `import pino from "pino"` (or Winston, Bunyan, …) becomes a refactor surface: APIs differ, child-logger shapes differ, and library consumers inherit *your* choice.

That trade-off is an old architectural debate:

- **Facade / ports** — libraries and domain code talk to a narrow interface; the host plugs in the writer. Classic statement: [SLF4J FAQ](https://www.slf4j.org/faq.html) (“libraries cannot afford to impose their choice of logging framework on the end-user”) and [SLF4J manual](https://www.slf4j.org/manual.html). Same idea in Clean / Hexagonal setups that treat logging as an outer adapter ([example write-up](https://blog.oopsmemory.com/logging-on-nestjs-like-a-pro-with-correlation-ids-log-aggregation-winston-morgan-and-more)).
- **Just pick one** — for a single app, some teams prefer calling Pino or Winston directly and skip the indirection. Comparisons of concrete libraries (not facades): [Dash0’s Node logging survey](https://www.dash0.com/guides/nodejs-logging-libraries), [Sentry’s 2026 guide](https://blog.sentry.io/javascript-logging-library-definitive-guide/).
- **Don’t wrap a facade in another facade** — wrapping SLF4J “just in case” is usually wasted surface area ([Stack Overflow discussion](https://stackoverflow.com/questions/978670/is-it-worth-wrapping-a-logging-framework-in-an-additional-layer)). Decohere’s Scribe *is* the shared facade; adapters are the bindings, not a second API for call sites.

Decohere chose the facade for the monorepo and published packages: **call sites stay on `@decohere/scribe`**, so switching writers is an adapter/composition change, not a rewrite of services and controllers. `@decohere/scribe` itself has **no runtime dependencies** and uses nothing Node-specific — it is safe to depend on from any layer, on any runtime with a `console`: browsers, Node, Deno, Bun, Workers ([ADR 0016](../../docs/adr/0016-scribe-on-any-runtime.md)). `@decohere/scribe-pino` is Decohere’s concrete **writer** — the same role as an SLF4J binding.

## Install

```bash
npm i @decohere/scribe
# optional Pino writer, with the peers pretty lines and rolling files need (Node):
npm i @decohere/scribe-pino pino-pretty pino-roll
# or JSON lines through console (Workers, browsers, Deno, Bun, Node):
npm i @decohere/scribe-console
```

```ts
import { scribe } from "@decohere/scribe";

const log = scribe.logger("Orders");
log.info("ready");
log.error(new Error("boom"));
```

Out of the box, Scribe uses an in-process `ConsoleAdapter` (writes through `console.log`). No adapter package required for that path. The first `scribe.logger(...)` before any `scribe.use` prints a one-time `console.warn` reminder to wire a real adapter at the composition root — treat the console fallback as convenience for scripts and tests, not production.

For structured JSON (and optional pretty lines or rolling files), add Pino at the composition root:

```ts
import { scribe } from "@decohere/scribe";
import { pino } from "@decohere/scribe-pino";

scribe.use(pino({ pretty: true, roll: { file: "logs/my-app.log" } }));

const log = scribe.logger("Api");
log.info("listening");
```

Options, and how to choose them per environment: [Pino](#pino-decoherescribe-pino).

## Public surface (`@decohere/scribe`)

| Symbol | Role |
|---|---|
| `scribe.logger(name?, customLevels?)` | Named logger; default levels `fatal` … `trace` |
| `scribe.use(adapter, { logLevel?, customLevels?, tap? }?)` | Write through `adapter` from now on; returns `(name?) => Logger` |
| `scribe.configure({ adapter, options?, tap? })` | The same, with the settings in one object |
| `scribe.flush(cb?)` / `scribe.stop()` | Drain / dispose the active adapter |
| `scribe.addContextSource(source)` | Add fields from what the caller is doing now (a request, a job) to every line; returns a remover |
| `LoggerAdapter` / `LogAdapter` | Contract and base class for writers |
| `LogEntryAdapter` | Base class for structured writers: implement `write(entry)` |
| `Logger<CustomLevels, CustomOnly>` | Typed log methods, `isLevelEnabled`, `child(fields)` |
| `LogEntry` / `logEntry.from` | One call as `{ level, name, msg, err, fields }` |
| `serializeError` | `{ name, message, stack, cause, ...props }`, causes three deep |
| `redact` / `DefaultRedactions` | Key-censoring helpers for adapters |
| `resolveLogLevel` / `getLogLevelFromEnv` | Level resolution helpers |
| `CaptureAdapter` (`@decohere/scribe/testing`) | Test double: keeps entries, prints nothing |

Default levels (numeric values match Pino’s scale): `fatal` 60, `error` 50, `warn` 40, `info` 30, `debug` 20, `trace` 10.

### Level env vars

When you do not pass an explicit `logLevel`, Scribe reads the first non-empty of:

1. `LOG_LEVEL`
2. `SCRIBE_LOG_LEVEL`
3. `LOGGING_LEVEL`

Invalid values are ignored. A level passed to `scribe.use` or `scribe.configure` always wins.

## Plugging in an adapter

```ts
import { ConsoleAdapter, scribe } from "@decohere/scribe";

const getLogger = scribe.use(new ConsoleAdapter(), { logLevel: "debug" });

const log = getLogger("Checkout");
log.debug("cart opened");
```

### Type-safe custom levels

`Logger` is generic over custom level *names*. Pass the same map at configure (or `scribe.logger(name, customLevels)`) and TypeScript exposes those methods:

```ts
import { ConsoleAdapter, scribe } from "@decohere/scribe";

const customLevels = { audit: 35, metric: 25 } as const;

const getLogger = scribe.use(new ConsoleAdapter(), { logLevel: "trace", customLevels });

const log = getLogger("Billing");
log.audit("invoice sealed"); // typed
log.metric("latency_ms", { value: 12 }); // typed
// log.nonsense — compile error
```

`customOnly: true` drops the default level methods and keeps only your map.

## Structured logging

### Argument rules

Every adapter reads a log call's arguments the same way. Structured adapters (`@decohere/scribe-console`, `CaptureAdapter`, your own `LogEntryAdapter`) and taps get them as a `LogEntry`:

| Call | Entry |
|---|---|
| `log.info("text")`, `log.info(42)` | `msg` |
| `log.error(err)` | `msg` is `err.message`, `err` the serialized error |
| `log.info({ orderId: 7 })`, `log.info({ orderId: 7 }, "text")` | `fields` (a string `msg` field becomes the message) |
| `log.info("text", { orderId: 7 })` | `msg` + `fields` |
| `log.error("text", err)` | `msg` + `err` |
| `log.info("text", value)` | `msg` + `fields.data`; further arguments go in `fields.args` |

### Child loggers

`child(fields)` binds context, such as a request id or a job name, to every entry. Children of children merge their fields, and a child of a `scribe.logger(...)` handle follows a later `configure` like its parent:

```ts
const log = scribe.logger("Api").child({ requestId });
log.info("received"); // { name: "Api", requestId, msg: "received" }
log.child({ job: "sync" }).warn("slow"); // { name: "Api", requestId, job: "sync", msg: "slow" }
```

### Context sources

A host can add fields to every line without each call site binding them. `scribe.addContextSource(source)` takes a function that returns the fields for the work going on now, or `undefined` when there is none. Scribe calls it on every log call from a `scribe.logger(...)` handle and binds what it returns, as `child` would, for every adapter and the tap:

```ts
const remove = scribe.addContextSource(() => currentJob == null ? undefined : { job: currentJob.id });
```

`@decohere/http` adds one that returns the request's `requestId` and `principalId` ([request context](../http/README.md#request-context-in-log-lines)). Sources outlive `configure`, adding the same function twice adds it once, and the returned function removes it. Fields a child binds win over a source's. Scribe itself keeps no context: the source decides what "now" means (Node's `AsyncLocalStorage`, a Worker's request), so the facade stays runtime-free.

A log call can pass a field a source also adds, such as its own `requestId`: the call's value wins, and the line has the field once.

### Errors

Structured adapters write errors as `err: { name, message, stack, cause, ...own properties }` (`code`, `statusCode`, …). An `Error` cause is serialized the same way, three levels deep. `serializeError(err, depth?)` is the same function, for your own adapters. Pino keeps its own error serializer, which appends causes to `message` and `stack`.

### Redaction

Scribe doesn't redact. Each adapter does it, or leaves it to the provider behind it. `redactions` is handed to the adapter as it is:

| Adapter | What it censors |
|---|---|
| `PinoAdapter` | Pino's own [`redact`](https://getpino.io/#/docs/redaction): the paths you give (defaults: `password`, `secret`, `token`, `otp`, `pw` and `userconfig`, at the top level and one level down). Pass Pino's own `redact` option to `PinoAdapter` for wildcards, a custom `censor` or `remove`. |
| `ConsoleAdapter`, `LogEntryAdapter` (so `JsonConsoleAdapter`, `CaptureAdapter`) | Each path's last segment as a key, at any depth |

Anything else, such as masking email addresses inside messages, belongs in your own adapter or in the provider's options.

### Entry tap

`tap` is called with every entry a `scribe.logger(...)` handle writes, whichever adapter writes it. Scribe doesn't redact what it hands the tap: the entry has the fields as they were logged, so redact in the tap (or in the reporter's own scrubbing, such as Sentry's `beforeSend`) before anything leaves the process. It is how an error reporter subscribes without wrapping the adapter:

```ts
scribe.configure({
  adapter: new JsonConsoleAdapter(),
  tap: (entry) => {
    if (entry.err != null && entry.level === "error") {
      Sentry.captureException(entry.err, { extra: entry.fields });
    }
  },
});
```

Levels the adapter has disabled are not tapped. A tap that throws does not break the call that logged; its error is rethrown on a microtask, so the runtime reports it as uncaught (under Node that ends the process, like any uncaught error). Catch inside the tap if it may fail.

## Outside Node (`@decohere/scribe-console`)

The facade runs on Cloudflare Workers, in browsers, Deno and Bun: it reads the level variables through `globalThis.process?.env` when there is one, and otherwise uses only `console`. For structured output there, use `JsonConsoleAdapter`. It writes one JSON object per entry, `{ level, name, msg, ...fields, err }`, through the console method of its level, which hosts like Workers Logs index:

```ts
import { scribe } from "@decohere/scribe";
import { JsonConsoleAdapter } from "@decohere/scribe-console";

scribe.configure({ adapter: new JsonConsoleAdapter(), options: { logLevel: "debug" } });

scribe.logger("Worker").child({ ray: request.headers.get("cf-ray") }).info("fetch");
// console.info('{"level":"info","name":"Worker","msg":"fetch","ray":"…"}')
```

| Level | Console method |
|---|---|
| `fatal`, `error` | `console.error` |
| `warn` | `console.warn` |
| `info` | `console.info` |
| `debug`, `trace` | `console.debug` (`console.trace` would print a stack) |

Custom levels take the method of the default level at or below their value. `new JsonConsoleAdapter({ timestamp: true })` adds `time` (ISO 8601) for hosts that don't stamp lines themselves. Cycles become `"[Circular]"`, and bigints become strings.

Without Node there are no level variables, so pass `logLevel` explicitly (from your Worker's `env`, for example).

## Testing with `CaptureAdapter`

`CaptureAdapter` keeps every entry that passes the level, prints nothing, and lets a test assert what was logged:

```ts
import { scribe } from "@decohere/scribe";
import { CaptureAdapter } from "@decohere/scribe/testing";

const capture = new CaptureAdapter();
scribe.configure({ adapter: capture });

await checkout.run();

expect(capture.at("error")).toEqual([
  expect.objectContaining({ msg: "charge failed", err: expect.objectContaining({ message: "card declined" }) }),
]);
capture.clear();
```

## Pino (`@decohere/scribe-pino`)

`pino(options?)` makes a Pino writer; `scribe.use` installs it. Importing the package changes nothing on its own.

```ts
import { scribe } from "@decohere/scribe";
import { pino } from "@decohere/scribe-pino";

scribe.use(pino()); // JSON lines on stdout
```

| Option | What it does |
|---|---|
| `pretty: true` or `{ colorize }` | Colourised lines through pino-pretty, for a terminal |
| `roll: { file, size?, frequency?, keep?, mkdir?, symlink? }` | Rolling log files through pino-roll. Defaults: `10m`, `daily`, keep `14`, `mkdir: true`, `symlink: false` |
| `transport` | Any other Pino transport, in place of `pretty` and `roll` |
| `logger` | Pino's own logger options, over the ones Scribe sets |

With both `pretty` and `roll`, every entry goes to both. The level, custom levels and the tap go to `scribe.use`: `scribe.use(pino(), { logLevel: "debug" })`.

### Development and production

Pretty lines and rolling files are for a developer's machine. In production, write JSON to stdout and let the platform ship it. `pino()` doesn't read the environment, so the app's entry decides, as a scaffolded app's `src/app.ts` does:

```ts
const development = process.env.NODE_ENV !== "production";
scribe.use(pino(development ? { pretty: true, roll: { file: "logs/my-app.log" } } : {}));
```

To let operators move the log file without a code change, read the variable there too: `roll: { file: process.env.LOG_FILE ?? "logs/my-app.log" }`.

`symlink: true` can race when several processes roll the same file, or on Flux reloads; leave it off unless you need a stable path to the newest file.

### Lifecycle

Pino worker transports must drain on shutdown and on a Flux reload:

```ts
await scribe.stop(); // or rely on Flux disposing the entry that calls stop
scribe.flush(() => process.exit(0));
```

A worker transport is wrapped in a `TransportGuard`: if it dies, logging stops with one line on stderr instead of crashing the process. Fix the cause (a symlink race, a full disk) rather than live with the line.

### Custom levels with Pino

```ts
scribe.use(pino(), { logLevel: "trace", customLevels: { audit: 35 } });

const log = scribe.logger<"audit">("Payments");
log.audit("settled");
```

Same generic `Logger<CustomLevels>` typing as the facade: the adapter forwards custom levels into Pino.

## Roll your own adapter

For a structured writer, subclass `LogEntryAdapter`: it handles levels, the threshold, `child` and censoring the `redactions` keys, and you write each `LogEntry`:

```ts
import { type LogEntry, LogEntryAdapter, scribe } from "@decohere/scribe";

class NdjsonStderrAdapter extends LogEntryAdapter {
  protected write(entry: LogEntry): void {
    const { level, name, msg, err, fields } = entry;
    process.stderr.write(`${JSON.stringify({ level, name, msg, ...fields, err })}\n`);
  }
}

scribe.configure({ adapter: new NdjsonStderrAdapter() });
```

For full control, implement `LoggerAdapter` (or subclass `LogAdapter`) and hand it to `scribe.configure`. Minimal sketch:

```ts
import {
  formatError,
  LogAdapter,
  type Logger,
  type ScribeOptions,
  scribe,
} from "@decohere/scribe";

class StderrAdapter extends LogAdapter {
  private level = "info";
  private levels: Record<string, number> = {};

  public configure<T extends string = never, C extends true | false = false>(
    options: ScribeOptions<T, C>,
  ) {
    this.levels = this.getLogLevels(options);
    this.level = options.logLevel ?? "info";
  }

  public getLogger<T extends string = never, C extends true | false = false>(
    name: string,
    bindings: Record<string, unknown> = {},
  ): Logger<T, C> {
    const levels = this.levels;
    const currentLevel = this.level;
    const threshold = levels[currentLevel] ?? 30;
    const write =
      (level: string) =>
      (msg: string | number | object, ...args: unknown[]) => {
        const text =
          msg instanceof Error ? formatError(msg) : typeof msg === "object" ? JSON.stringify(msg) : String(msg);
        process.stderr.write(`${level.toUpperCase()} [${name}] ${text}\n`);
        if (args.length) process.stderr.write(`${JSON.stringify([...args, bindings])}\n`);
      };
    const noop = () => {};
    const logger = {
      get currentLevel() {
        return currentLevel;
      },
      get logLevels() {
        return levels;
      },
      isLevelEnabled: (level: string) => (levels[level] ?? 0) >= threshold,
      child: (fields: Record<string, unknown>) =>
        this.getLogger<T, C>(name, { ...bindings, ...fields }),
    };
    for (const [level, value] of Object.entries(levels)) {
      (logger as Record<string, unknown>)[level] = value >= threshold ? write(level) : noop;
    }
    return logger as Logger<T, C>;
  }
}

scribe.configure({ adapter: new StderrAdapter() });
```

### Illustrative Winston adapter (untested)

The following shows the shape of a Winston binding. **It is not shipped, not tested, and not supported** — copy and adapt at your own risk. Prefer `@decohere/scribe-pino` in Decohere apps.

```ts
import {
  formatError,
  LogAdapter,
  type Logger,
  type ScribeOptions,
  scribe,
} from "@decohere/scribe";
import winston from "winston";

/** Example only — not tested with current Winston releases. */
export class WinstonAdapter extends LogAdapter {
  private root!: winston.Logger;

  public configure<T extends string = never, C extends true | false = false>(
    options: ScribeOptions<T, C>,
  ) {
    const levels = this.getLogLevels(options);
    this.root = winston.createLogger({
      levels,
      level: options.logLevel ?? "info",
      format: winston.format.json(),
      transports: [new winston.transports.Console()],
    });
  }

  public getLogger<T extends string = never, C extends true | false = false>(
    name: string,
  ): Logger<T, C> {
    return this.wrap<T, C>(this.root.child({ name }));
  }

  private wrap<T extends string, C extends true | false>(child: winston.Logger): Logger<T, C> {
    const wrap =
      (level: string) =>
      (msg: string | number | object, ...args: unknown[]) => {
        if (msg instanceof Error) {
          child.log(level, formatError(msg), { err: msg, ...args });
          return;
        }
        child.log(level, typeof msg === "object" ? JSON.stringify(msg) : String(msg), ...args);
      };
    const logger = {
      get currentLevel() {
        return child.level;
      },
      get logLevels() {
        return child.levels;
      },
      isLevelEnabled: (level: string) => child.isLevelEnabled(level),
      child: (fields: Record<string, unknown>) => this.wrap<T, C>(child.child(fields)),
    };
    for (const level of Object.keys(child.levels)) {
      (logger as Record<string, unknown>)[level] = wrap(level);
    }
    return logger as Logger<T, C>;
  }

  public flush(cb?: () => void): void {
    // Winston has no single flush; drain transports if you need durability.
    cb?.();
  }
}

// Composition root only:
// scribe.configure({ adapter: new WinstonAdapter(), options: { logLevel: "info" } });
```

## Living with a host Pino logger

Decohere libraries depend on `@decohere/scribe` and call `scribe.logger(...)`. Your app may already own Pino for its own code. Today those are **two stacks** unless the composition root wires them together.

### What happens today

```ts
import pino from "pino";
import { scribe } from "@decohere/scribe";
import { pino as scribePino } from "@decohere/scribe-pino";
// somewhere inside @decohere/http (or another decohere package):
//   const log = scribe.logger("Http");
//   log.info("request");

// Your app’s logger — destinations, redaction, bindings you already configured
const appLog = pino({ level: "info" });
appLog.info("boot");

// Decohere packages still write through Scribe’s active adapter (console by
// default, or a *second* Pino root once you add one).
scribe.use(scribePino({ pretty: true })); // creates its own pino() — not appLog
```

So you get either:

| Composition root | Result |
|---|---|
| Do nothing | App → your Pino; Decohere libs → Scribe console |
| `scribe.use(pino(…))` or `PinoAdapter` | App → your Pino; Decohere libs → **another** Pino root (duplicate workers / files / levels) |
| Drop direct Pino; only use Scribe | One writer — but you give up your existing `pino` handle |

There is **no** API yet to hand Scribe an existing logger (`scribe.configure({ logger: appLog })` or `PinoAdapter.from(appLog)`).

### Coming soon — adopt the host logger

The straightforward fix is to let the host pass its root logger into Scribe so `scribe.logger("X")` becomes a child of that root (same destination, levels, and process lifecycle). Planned shape (not implemented):

```ts
import pino from "pino";
import { scribe } from "@decohere/scribe";
// import { PinoAdapter } from "@decohere/scribe-pino"; // when shipped

const appLog = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: process.env.NODE_ENV === "production"
    ? undefined
    : { target: "pino-pretty", options: { colorize: true } },
});

// Planned — do not call yet:
// scribe.use(PinoAdapter.from(appLog));

appLog.info("app boot");
// decohere lib: scribe.logger("Http").info("request") → appLog.child({ name: "Http" })
```

Until that lands, prefer **one** owner of logging in the composition root: either configure Scribe with `@decohere/scribe-pino` and stop importing Pino directly in app code, or accept that Decohere packages log through the console adapter.

## Non-goals

- Shipping Pino, Winston, or file rotation inside `@decohere/scribe`
- Depending on `@decohere/scribe-pino` from domain libraries (depend on `@decohere/scribe` only)
- Using in-process roll/pretty as the production shipping strategy
- Reading the environment inside a writer: the app's entry decides what to pass
- Replacing platform log shipping (stdout collectors, sidecars, agents)
- A second application-facing API on top of Scribe (call `scribe.logger`, not the adapter)

## Related

| Package / doc | Role |
|---|---|
| [Spying on Scribe loggers](../../docs/testing/how-tos/spying-on-scribe-loggers.md) | Test doubles without fighting Pino |
| [ADR 0016](../../docs/adr/0016-scribe-on-any-runtime.md) | Why the facade runs anywhere and writers are adapter packages |
