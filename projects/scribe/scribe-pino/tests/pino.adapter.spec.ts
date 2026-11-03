import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { LogAdapter, scribe } from "@decohere/scribe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PinoAdapter } from "../src/pino.adapater.js";
import { pinoTransport } from "../src/scribe-pino.js";

function makeStream(): { stream: Writable; lines: () => string[] } {
	const chunks: string[] = [];
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			chunks.push(chunk.toString());
			callback();
		},
	});
	return { stream, lines: () => chunks };
}

describe("PinoAdapter", () => {
	it("logs the error message when passed an Error object as the first argument", () => {
		const { stream, lines } = makeStream();
		const adapter = new PinoAdapter({ level: "error" }, stream);
		const loggerFactory = scribe.configure({ adapter, options: { logLevel: "error" } });
		const logger = loggerFactory("test");

		logger.error(new Error("something went wrong"));

		const output = lines().join("");
		expect(output).toContain("something went wrong");
	});

	it("stop flushes and ends the destination stream", async () => {
		const { stream } = makeStream();
		const end = vi.spyOn(stream, "end");
		const adapter = new PinoAdapter({ level: "info" }, stream);
		scribe.configure({ adapter, options: { logLevel: "info" } });
		scribe.logger("drain").info("before stop");

		await adapter.stop();
		expect(end).toHaveBeenCalled();

		await adapter.stop();
		expect(end).toHaveBeenCalledTimes(1);
	});

	it("stop completes when destination end ignores callbacks (ThreadStream)", async () => {
		const stream = Object.assign(new EventEmitter(), {
			destroyed: false,
			closed: false,
			writableFinished: false,
			write(_chunk: unknown, encodingOrCb?: unknown, cb?: unknown) {
				const done =
					typeof encodingOrCb === "function"
						? encodingOrCb
						: typeof cb === "function"
							? cb
							: undefined;
				if (typeof done === "function") {
					done();
				}
				return true;
			},
			end() {
				queueMicrotask(() => {
					this.writableFinished = true;
					this.emit("finish");
					this.destroyed = true;
					this.closed = true;
					this.emit("close");
				});
			},
			destroy: vi.fn(),
		});
		const adapter = new PinoAdapter({ level: "info" }, stream as never);
		scribe.configure({ adapter, options: { logLevel: "info" } });
		scribe.logger("drain").info("before stop");

		await expect(adapter.stop()).resolves.toBeUndefined();
	});

	it("retire destroys the destination before stop", () => {
		const { stream } = makeStream();
		const destroy = vi.spyOn(stream, "destroy");
		const adapter = new PinoAdapter({ level: "info" }, stream);
		scribe.configure({ adapter, options: { logLevel: "info" } });

		adapter.retire();
		expect(destroy).toHaveBeenCalled();
		adapter.retire();
		expect(destroy).toHaveBeenCalledTimes(1);
	});
});

describe("pinoTransport.guardTransport", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("retires once on error and no-ops further writes", () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const writes: string[] = [];
		const stream = new Writable({
			write(chunk, _encoding, callback) {
				writes.push(String(chunk));
				callback();
			},
		});
		const guarded = pinoTransport.guardTransport(stream);

		expect(stream.write("alive")).toBe(true);
		stream.emit("error", new Error("the worker has exited"));
		expect(stream.write("dead-1")).toBe(true);
		expect(stream.write("dead-2")).toBe(true);

		expect(writes).toEqual(["alive"]);
		expect(guarded.retired).toBe(true);
		expect(
			stderr.mock.calls.filter((c) => String(c[0]).includes("transport retired")),
		).toHaveLength(1);
		expect(String(stderr.mock.calls[0]?.[0])).toContain("the worker has exited");
	});

	it("retires when write throws", () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const transport = Object.assign(new EventEmitter(), {
			write(_chunk?: unknown) {
				throw new Error("the worker has exited");
			},
			destroy: vi.fn(),
		});
		const guarded = pinoTransport.guardTransport(transport as never);

		expect(transport.write("x")).toBe(true);
		expect(transport.write("y")).toBe(true);
		expect(guarded.retired).toBe(true);
		expect(transport.destroy).toHaveBeenCalledTimes(1);
		expect(
			stderr.mock.calls.filter((c) => String(c[0]).includes("transport retired")),
		).toHaveLength(1);
	});

	it("silenceErrors still guards without crashing", () => {
		const transport = new EventEmitter();
		pinoTransport.silenceErrors(transport as never);
		expect(() =>
			transport.emit("error", new Error("EEXIST: file already exists")),
		).not.toThrow();
	});
});

describe("scribe.configure retires previous adapter", () => {
	it("calls retire on the previous adapter before swap", () => {
		class SpyAdapter extends LogAdapter {
			public retire = vi.fn();
			public configure() {}
			public getLogger() {
				return {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					trace: vi.fn(),
					fatal: vi.fn(),
					child: vi.fn(),
					currentLevel: "info",
					logLevels: {},
				} as never;
			}
		}

		const first = new SpyAdapter();
		scribe.configure({ adapter: first });
		const second = new SpyAdapter();
		scribe.configure({ adapter: second });

		expect(first.retire).toHaveBeenCalled();
	});
});
