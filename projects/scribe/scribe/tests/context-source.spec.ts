import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type LogEntry, scribe } from "../src/index.js";
import { CaptureAdapter } from "../src/testing/index.js";

describe("scribe.addContextSource", () => {
	let capture: CaptureAdapter;
	let current: Record<string, unknown> | undefined;
	let remove: () => void;
	const source = () => current;

	beforeEach(() => {
		capture = new CaptureAdapter();
		scribe.configure({ adapter: capture, options: { logLevel: "info" } });
		current = undefined;
		remove = scribe.addContextSource(source);
	});

	afterEach(() => {
		remove();
	});

	it("adds the source's fields to every line while it returns them", () => {
		const log = scribe.logger("Orders");

		current = { requestId: "r-1" };
		log.info("inside");
		current = undefined;
		log.info("outside");

		expect(capture.entries.map((entry) => entry.fields)).toEqual([{ requestId: "r-1" }, {}]);
	});

	it("lets a child's own fields win over the source's", () => {
		current = { requestId: "r-1", job: "from-source" };

		scribe.logger("Orders").child({ job: "sync" }).info("child");

		expect(capture.entries[0]?.fields).toEqual({ requestId: "r-1", job: "sync" });
	});

	it("keeps working after a later configure", () => {
		const log = scribe.logger("Orders");
		const next = new CaptureAdapter();
		scribe.configure({ adapter: next, options: { logLevel: "info" } });

		current = { requestId: "r-2" };
		log.info("after");

		expect(next.entries[0]?.fields).toEqual({ requestId: "r-2" });
	});

	it("hands the tap the same fields", () => {
		const tapped: LogEntry[] = [];
		scribe.configure({ adapter: capture, tap: (entry) => tapped.push(entry) });

		current = { requestId: "r-3" };
		scribe.logger("Orders").warn("tapped");

		expect(tapped[0]?.fields).toEqual({ requestId: "r-3" });
	});

	it("adds a source once however often it is added, and stops when removed", () => {
		scribe.addContextSource(source);
		current = { requestId: "r-4" };
		remove();

		scribe.logger("Orders").info("removed");

		expect(capture.entries[0]?.fields).toEqual({});
	});
});
