import { describe, expect, it } from "vitest";
import { sseWire } from "../src/sse/sse.wire.js";

// Edges the HTTP tests cannot see: what the bytes look like for hostile or odd input.
describe("SSE wire format", () => {
	it("cannot be made to inject a field through a line break in id or event", () => {
		const frame = sseWire.formatMessage({
			id: "1\ndata: injected",
			event: "a\r\nretry: 1",
			data: "x",
		});

		expect(frame).toBe("id: 1 data: injected\nevent: a retry: 1\ndata: x\n\n");
	});

	it("splits multi-line data into one data field per line, whatever the line ending", () => {
		expect(sseWire.formatMessage("a\r\nb\rc\nd")).toBe(
			"data: a\ndata: b\ndata: c\ndata: d\n\n",
		);
	});

	it("writes non-string data as JSON and a bare string as-is", () => {
		expect(sseWire.formatMessage({ data: { n: 1 } })).toBe('data: {"n":1}\n\n');
		expect(sseWire.formatMessage("hi")).toBe("data: hi\n\n");
		expect(sseWire.formatMessage(42)).toBe("data: 42\n\n");
	});

	it("writes retry as a whole number of milliseconds", () => {
		expect(sseWire.formatMessage({ data: "x", retry: 1500.9 })).toBe(
			"retry: 1500\ndata: x\n\n",
		);
	});
});
