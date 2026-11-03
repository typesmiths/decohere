import { describe, expect, it } from "vitest";
import { createBadgeSvg, getColor, statusToColor, statusToText } from "../../src/lib/svg.mjs";

describe("getColor", () => {
	it("returns green for >= 90%", () => {
		expect(getColor(90)).toBe("#2ea043");
		expect(getColor(100)).toBe("#2ea043");
	});

	it("returns light green for >= 80%", () => {
		expect(getColor(80)).toBe("#3fb950");
		expect(getColor(89)).toBe("#3fb950");
	});

	it("returns yellow for >= 70%", () => {
		expect(getColor(70)).toBe("#9a6700");
		expect(getColor(79)).toBe("#9a6700");
	});

	it("returns orange for >= 60%", () => {
		expect(getColor(60)).toBe("#db6d28");
		expect(getColor(69)).toBe("#db6d28");
	});

	it("returns red for < 60%", () => {
		expect(getColor(59)).toBe("#cf222e");
		expect(getColor(0)).toBe("#cf222e");
	});
});

describe("createBadgeSvg", () => {
	it("generates valid SVG with label and value", () => {
		const svg = createBadgeSvg("Coverage", "92.5%", "#2ea043");
		expect(svg).toContain("<svg");
		expect(svg).toContain("Coverage");
		expect(svg).toContain("92.5%");
		expect(svg).toContain("#2ea043");
		expect(svg).toContain("</svg>");
	});

	it("sets aria-label with label and value", () => {
		const svg = createBadgeSvg("CI Main", "passing", "#2ea043");
		expect(svg).toContain('aria-label="CI Main: passing"');
	});

	it("sets title element", () => {
		const svg = createBadgeSvg("Coverage", "75%", "#9a6700");
		expect(svg).toContain("<title>Coverage: 75%</title>");
	});
});

describe("statusToColor", () => {
	it("returns orange for in_progress", () => {
		expect(statusToColor("in_progress", null)).toBe("#fb8500");
	});

	it("returns green for success", () => {
		expect(statusToColor("completed", "success")).toBe("#2ea043");
	});

	it("returns red for failure", () => {
		expect(statusToColor("completed", "failure")).toBe("#cf222e");
	});

	it("returns gray for cancelled", () => {
		expect(statusToColor("completed", "cancelled")).toBe("#6e7781");
	});

	it("returns gray for unknown", () => {
		expect(statusToColor("completed", "unknown")).toBe("#6e7781");
	});
});

describe("statusToText", () => {
	it("returns 'running' for in_progress", () => {
		expect(statusToText("in_progress", null)).toBe("running");
	});

	it("returns 'passing' for success", () => {
		expect(statusToText("completed", "success")).toBe("passing");
	});

	it("returns 'failing' for failure", () => {
		expect(statusToText("completed", "failure")).toBe("failing");
	});

	it("returns 'cancelled' for cancelled", () => {
		expect(statusToText("completed", "cancelled")).toBe("cancelled");
	});

	it("returns 'unknown' for unrecognized state", () => {
		expect(statusToText("completed", "timed_out")).toBe("unknown");
	});
});
