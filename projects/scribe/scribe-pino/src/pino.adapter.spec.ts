import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { LogAdapter, scribe } from "@decohere/scribe";
import { describe, expect, it, vi } from "vitest";
import { PinoAdapter } from "./pino.adapter.js";

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

	it("writes a field once when a log call passes one a context source also adds", () => {
		const { stream, lines } = makeStream();
		const adapter = new PinoAdapter({ level: "info" }, stream);
		const logger = scribe.configure({ adapter, options: { logLevel: "info" } })("test");
		const remove = scribe.addContextSource(() => ({
			requestId: "from-request",
			tenant: "t-1",
		}));
		try {
			logger.info({ requestId: "mine" }, "fields first");
			logger.info("fields second", { requestId: "mine" });
			logger.info("passed none");
		} finally {
			remove();
		}

		const [first, second, none] = lines();
		for (const [line, msg] of [
			[first, "fields first"],
			[second, "fields second"],
		]) {
			expect(line?.match(/"requestId"/g)).toHaveLength(1);
			expect(JSON.parse(line ?? "")).toMatchObject({ requestId: "mine", tenant: "t-1", msg });
		}
		expect(JSON.parse(none ?? "")).toMatchObject({ requestId: "from-request", tenant: "t-1" });
	});

	it("flush finishes through flushSync on a worker transport, whose flush can wait forever", () => {
		const hangingFlush = vi.fn();
		const flushSync = vi.fn();
		const stream = { write: vi.fn(), flush: hangingFlush, flushSync };
		const adapter = new PinoAdapter({}, stream);
		adapter.configure({ logLevel: "info" });
		const done = vi.fn();

		adapter.flush(done);

		expect(flushSync).toHaveBeenCalledOnce();
		expect(hangingFlush).not.toHaveBeenCalled();
		expect(done).toHaveBeenCalledOnce();
	});

	it("flush lets a failed flushSync reach the caller instead of hanging", () => {
		const stream = {
			write: vi.fn(),
			flushSync: () => {
				throw new Error("_flushSync took too long (10s)");
			},
		};
		const adapter = new PinoAdapter({}, stream);
		adapter.configure({ logLevel: "info" });

		expect(() => adapter.flush(vi.fn())).toThrow("took too long");
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
