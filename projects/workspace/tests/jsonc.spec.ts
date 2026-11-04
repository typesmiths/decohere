import { describe, expect, it } from "vitest";
import { parseJsonc } from "../src/models/jsonc.js";

describe("parseJsonc", () => {
	it("reads plain JSON", () => {
		expect(parseJsonc('{"a": 1, "b": [true, null]}')).toEqual({ a: 1, b: [true, null] });
	});

	it("reads an empty file as an empty object, as tsc does", () => {
		expect(parseJsonc("")).toEqual({});
		expect(parseJsonc(" \n\t")).toEqual({});
	});

	it("skips line and block comments", () => {
		expect(parseJsonc('{\n// line\n"a": /* block */ 1 /* multi\nline */}')).toEqual({ a: 1 });
	});

	it("allows trailing commas in objects and arrays", () => {
		expect(parseJsonc('{"a": [1, 2,], "b": 3,}')).toEqual({ a: [1, 2], b: 3 });
	});

	it("leaves comment and comma characters inside strings alone", () => {
		expect(parseJsonc('{"url": "https://x/*y*/", "s": "a,}", "q": "\\"//"}')).toEqual({
			url: "https://x/*y*/",
			s: "a,}",
			q: '"//',
		});
	});

	it("throws on broken JSON", () => {
		expect(() => parseJsonc("{")).toThrow(SyntaxError);
		expect(() => parseJsonc('{"a": }')).toThrow(SyntaxError);
	});

	it("throws on a comment that never closes", () => {
		expect(() => parseJsonc('{"a": 1 /* open')).toThrow(SyntaxError);
	});
});
