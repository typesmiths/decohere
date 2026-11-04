/**
 * Scribe + Pino through the public recipe surface (`withPino*` / `scribe.logger`).
 *
 * Prefer observable outcomes: logger level, JSON on a destination stream, roll files
 * on real fs. Unit suites already cover `pinoRecipe.transport` plan shapes.
 */
import "@decohere/scribe-pino";
import { join } from "node:path";
import { Writable } from "node:stream";
import { Shell } from "@decohere/devkit/interop";
import { ConsoleAdapter, scribe } from "@decohere/scribe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { realFs } from "../../../../tests/fs.setup.js";
import { PinoAdapter } from "../src/pino.adapater.js";

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await scribe.stop();
});

function captureStream(): { stream: Writable; text: () => string } {
	const chunks: string[] = [];
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(String(chunk));
			callback();
		},
	});
	return { stream, text: () => chunks.join("") };
}

function dumpArg(arg: unknown): string {
	if (arg == null) {
		return String(arg);
	}
	if (typeof arg === "object") {
		try {
			return JSON.stringify(arg);
		} catch {
			return String(arg);
		}
	}
	return String(arg);
}

function captureConsole(): { text: () => string } {
	const chunks: string[] = [];
	const dump = (...args: unknown[]) => {
		chunks.push(args.map(dumpArg).join(" "));
	};
	vi.spyOn(console, "log").mockImplementation(dump);
	vi.spyOn(console, "error").mockImplementation(dump);
	return { text: () => chunks.join("\n") };
}

/** Fixture OTP — not a real credential; unique so a leak cannot hide in paths. */
const OTP_FIXTURE = "otp-fixture-redact-me";

class OtpArgvShell extends Shell {
	protected program = "true";

	public runPublish(otp: string) {
		return this.run({}, "publish", "--otp", otp);
	}
}

describe("scribe-pino recipes (behavior)", () => {
	it("writes structured JSON with logger name via PinoAdapter", async () => {
		const { stream, text } = captureStream();
		scribe.configure({
			adapter: new PinoAdapter({}, stream),
			options: { logLevel: "info" },
		});
		scribe.logger("Api").info("listening");
		await new Promise((r) => setTimeout(r, 20));
		const line = text();
		expect(line).toContain('"name":"Api"');
		expect(line).toContain("listening");
	});

	it("withPinoRoll persists a line to the roll file", async () => {
		const dir = realFs.mkdtempSync(join(realFs.realpathSync("/tmp"), "scribe-pino-roll-"));
		const file = join(dir, "app.log");
		vi.stubEnv("NODE_ENV", "development");

		scribe.withPinoRoll({ file, when: "always", size: "1m", keep: 2, mkdir: true });
		scribe.logger("roll").info("hello-roll");
		await new Promise((r) => setTimeout(r, 800));
		await scribe.stop();
		await new Promise((r) => setTimeout(r, 200));

		const bodies = realFs.readdirSync(dir).map((name) => {
			try {
				return realFs.readFileSync(join(dir, name), "utf8");
			} catch {
				return "";
			}
		});
		expect(bodies.some((body) => body.includes("hello-roll"))).toBe(true);
		realFs.rmSync(dir, { recursive: true, force: true });
	}, 15_000);

	it("SCRIBE_LOG_FILE redirects roll destination without app code changes", async () => {
		const dir = realFs.mkdtempSync(join(realFs.realpathSync("/tmp"), "scribe-pino-env-"));
		const defaultFile = join(dir, "default.log");
		const overrideFile = join(dir, "override.log");
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("SCRIBE_LOG_FILE", overrideFile);

		scribe.withPinoRoll({
			file: defaultFile,
			when: "always",
			size: "1m",
			keep: 2,
			mkdir: true,
		});
		scribe.logger("roll").info("env-redirect");
		await new Promise((r) => setTimeout(r, 800));
		await scribe.stop();
		await new Promise((r) => setTimeout(r, 200));

		const bodies = realFs.readdirSync(dir).map((name) => {
			try {
				return { name, body: realFs.readFileSync(join(dir, name), "utf8") };
			} catch {
				return { name, body: "" };
			}
		});
		expect(
			bodies.some((f) => f.name.startsWith("override") && f.body.includes("env-redirect")),
		).toBe(true);
		expect(
			bodies.some((f) => f.name.startsWith("default") && f.body.includes("env-redirect")),
		).toBe(false);
		realFs.rmSync(dir, { recursive: true, force: true });
	}, 15_000);

	it("skips in-process roll when NODE_ENV=production and when is development", async () => {
		const dir = realFs.mkdtempSync(join(realFs.realpathSync("/tmp"), "scribe-pino-prod-"));
		const file = join(dir, "app.log");
		vi.stubEnv("NODE_ENV", "production");

		scribe.withPinoRoll({ file, when: "development" });
		scribe.logger("prod").info("stdout-only");
		await scribe.stop();
		await new Promise((r) => setTimeout(r, 200));

		expect(realFs.existsSync(file)).toBe(false);
		realFs.rmSync(dir, { recursive: true, force: true });
	});

	/**
	 * Omitting recipe logLevel must still consult LOG_LEVEL /
	 * SCRIBE_LOG_LEVEL (same as bare `scribe.configure` without a logLevel).
	 */
	it("withPinoPretty honors SCRIBE_LOG_LEVEL when logLevel is omitted", () => {
		vi.stubEnv("SCRIBE_LOG_LEVEL", "debug");
		scribe.withPinoPretty();
		const log = scribe.logger("EnvPretty");
		expect(log.currentLevel).toBe("debug");
		expect(log.isLevelEnabled("debug")).toBe(true);
	});

	it("withPino honors LOG_LEVEL when logLevel is omitted", () => {
		vi.stubEnv("LOG_LEVEL", "warn");
		scribe.withPino({
			transports: { target: "pino/file", options: { destination: 1 } },
		});
		expect(scribe.logger("EnvPino").currentLevel).toBe("warn");
	});

	it("withPinoRoll honors SCRIBE_LOG_LEVEL when logLevel is omitted", () => {
		vi.stubEnv("SCRIBE_LOG_LEVEL", "trace");
		vi.stubEnv("NODE_ENV", "production");
		scribe.withPinoRoll({ file: "logs/unused.log" });
		expect(scribe.logger("EnvRoll").currentLevel).toBe("trace");
	});

	it("withPinoCustom honors SCRIBE_LOG_LEVEL when scribe.logLevel is omitted", () => {
		vi.stubEnv("SCRIBE_LOG_LEVEL", "debug");
		scribe.withPinoCustom({});
		expect(scribe.logger("EnvCustom").currentLevel).toBe("debug");
	});

	/**
	 * A logger obtained before reconfigure should write to the
	 * new destination after configure.
	 */
	it("late configure updates already-created pino logger destination", async () => {
		const first = captureStream();
		const second = captureStream();

		scribe.configure({
			adapter: new PinoAdapter({}, first.stream),
			options: { logLevel: "info" },
		});
		const log = scribe.logger("Early");
		log.info("first");

		scribe.configure({
			adapter: new PinoAdapter({}, second.stream),
			options: { logLevel: "info" },
		});
		log.info("second");
		await new Promise((r) => setTimeout(r, 30));

		expect(second.text()).toContain("second");
	});
});

/**
 * Scribe owns redaction keys. Shell logs structured `{ program, args }`
 * so adapters can censor `otp` / `token` / `password` / …  Do not interpolate argv
 * into the message string (that bypasses path-based redaction).
 */
describe("scribe adapters and Shell secrets", () => {
	it("PinoAdapter redacts password, secret, token, otp, pw, and userconfig at top-level and one nest", async () => {
		const { stream, text } = captureStream();
		scribe.configure({
			adapter: new PinoAdapter({}, stream),
			options: { logLevel: "info" },
		});
		const fields = {
			password: "field-password-redact-me",
			secret: "field-secret-redact-me",
			token: "field-token-redact-me",
			otp: "field-otp-redact-me",
			pw: "field-pw-redact-me",
			userconfig: "field-userconfig-redact-me",
		};
		scribe.logger("Secrets").info("probe", {
			...fields,
			nested: {
				password: `${fields.password}-nested`,
				secret: `${fields.secret}-nested`,
				token: `${fields.token}-nested`,
				otp: `${fields.otp}-nested`,
				pw: `${fields.pw}-nested`,
				userconfig: `${fields.userconfig}-nested`,
			},
		});
		await new Promise((r) => setTimeout(r, 20));
		const out = text();
		for (const value of Object.values(fields)) {
			expect(out).not.toContain(value);
			expect(out).not.toContain(`${value}-nested`);
		}
		expect(out).toContain("[Redacted]");
	});

	it("PinoAdapter JSON destination does not contain a secret passed on Shell argv", async () => {
		const { stream, text } = captureStream();
		const cons = captureConsole();
		scribe.configure({
			adapter: new PinoAdapter({}, stream),
			options: { logLevel: "info" },
		});
		const result = await new OtpArgvShell().runPublish(OTP_FIXTURE);
		await scribe.stop();
		expect(result.message).not.toContain(OTP_FIXTURE);
		expect(`${text()}\n${cons.text()}`).not.toContain(OTP_FIXTURE);
	});

	it("ConsoleAdapter does not contain a secret passed on Shell argv", async () => {
		const cons = captureConsole();
		scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "info" },
		});
		const result = await new OtpArgvShell().runPublish(OTP_FIXTURE);
		expect(result.message).not.toContain(OTP_FIXTURE);
		expect(cons.text()).not.toContain(OTP_FIXTURE);
	});
});

/** Typed child loggers. */
describe("PinoAdapter child loggers", () => {
	function lines(text: string): Record<string, unknown>[] {
		return text
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	}

	it("child adds fields, keeps the name, and nests", async () => {
		const { stream, text } = captureStream();
		scribe.configure({ adapter: new PinoAdapter({}, stream) });
		const request = scribe.logger("Api").child({ requestId: "r-1" });
		const job = request.child({ job: "sync" });
		request.info("received");
		job.warn("slow");
		await new Promise((r) => setTimeout(r, 20));
		expect(job.currentLevel).toBe("info");
		expect(job.isLevelEnabled("debug")).toBe(false);
		const [received, slow] = lines(text());
		expect(received).toMatchObject({ name: "Api", requestId: "r-1", msg: "received" });
		expect(received).not.toHaveProperty("job");
		expect(slow).toMatchObject({ name: "Api", requestId: "r-1", job: "sync", msg: "slow" });
	});
});
