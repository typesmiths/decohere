import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportGuard } from "./transport-guard.service.js";

describe("TransportGuard", () => {
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
		const guarded = new TransportGuard(stream);

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
		const guarded = new TransportGuard(transport as never);

		expect(transport.write("x")).toBe(true);
		expect(transport.write("y")).toBe(true);
		expect(guarded.retired).toBe(true);
		expect(transport.destroy).toHaveBeenCalledTimes(1);
		expect(
			stderr.mock.calls.filter((c) => String(c[0]).includes("transport retired")),
		).toHaveLength(1);
	});
});
