import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../../src/packaging/unified-diff.js";

function applyOne(content: string | undefined, patch: string): string | null {
	const [file] = unifiedDiff.parse(patch);
	return unifiedDiff.apply(content, file);
}

const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`);

describe("unifiedDiff", () => {
	it("reads git's file headers, stripping the a/ and b/ prefixes", () => {
		const files = unifiedDiff.parse(
			[
				"diff --git a/es6/src/one.js b/es6/src/one.js",
				"index 3354048..52b025c 100644",
				"--- a/es6/src/one.js",
				"+++ b/es6/src/one.js",
				"@@ -1 +1 @@",
				"-a",
				"+b",
				"diff --git a/es6/two.js b/es6/two.js",
				"--- a/es6/two.js",
				"+++ b/es6/two.js",
				"@@ -1 +1 @@",
				"-c",
				"+d",
				"",
			].join("\n"),
		);

		expect(files.map((file) => [file.oldPath, file.newPath])).toEqual([
			["es6/src/one.js", "es6/src/one.js"],
			["es6/two.js", "es6/two.js"],
		]);
	});

	it("applies several hunks, each where its context is when lines above it moved", () => {
		const content = `${["added above", ...lines(20)].join("\n")}\n`;
		const patch = [
			"--- a/f.js",
			"+++ b/f.js",
			"@@ -2,3 +2,4 @@",
			" line 2",
			"+new after 2",
			" line 3",
			" line 4",
			"@@ -15,3 +16,2 @@",
			" line 15",
			"-line 16",
			" line 17",
			"",
		].join("\n");

		const result = applyOne(content, patch)?.split("\n") ?? [];

		expect(result.slice(0, 5)).toEqual([
			"added above",
			"line 1",
			"line 2",
			"new after 2",
			"line 3",
		]);
		expect(result).not.toContain("line 16");
		expect(result).toContain("line 17");
	});

	it("names the hunk that doesn't match", () => {
		const patch = [
			"--- a/f.js",
			"+++ b/f.js",
			"@@ -1,2 +1,2 @@",
			" line 1",
			"-gone",
			"+new",
			"",
		];

		expect(() => applyOne("line 1\nline 2\n", patch.join("\n"))).toThrow(
			"hunk 1 (@@ -1,2 +1,2 @@) doesn't match the file",
		);
	});

	it("creates a new file and deletes an old one", () => {
		const created = [
			"diff --git a/new.js b/new.js",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/new.js",
			"@@ -0,0 +1,2 @@",
			"+one",
			"+two",
			"",
		].join("\n");
		const deleted = [
			"diff --git a/old.js b/old.js",
			"deleted file mode 100644",
			"--- a/old.js",
			"+++ /dev/null",
			"@@ -1 +0,0 @@",
			"-gone",
			"",
		].join("\n");

		expect(applyOne(undefined, created)).toBe("one\ntwo\n");
		expect(() => applyOne("exists\n", created)).toThrow("already exists");
		expect(applyOne("gone\n", deleted)).toBeNull();
		expect(() => applyOne(undefined, deleted)).toThrow("doesn't exist");
	});

	it("keeps or adds the newline at the end of the file as the patch says", () => {
		const addsNewline = [
			"--- a/f.js",
			"+++ b/f.js",
			"@@ -1 +1 @@",
			"-last",
			"\\ No newline at end of file",
			"+last",
			"",
		].join("\n");
		const dropsNewline = [
			"--- a/f.js",
			"+++ b/f.js",
			"@@ -1 +1 @@",
			"-last",
			"+last",
			"\\ No newline at end of file",
			"",
		].join("\n");

		expect(applyOne("last", addsNewline)).toBe("last\n");
		expect(() => applyOne("last\n", addsNewline)).toThrow("doesn't match");
		expect(applyOne("last\n", dropsNewline)).toBe("last");
	});

	it("reads an empty context line whose leading space was stripped", () => {
		const patch = ["--- a/f.js", "+++ b/f.js", "@@ -1,3 +1,3 @@", " a", "", "-b", "+c", ""];

		expect(applyOne("a\n\nb\n", patch.join("\n"))).toBe("a\n\nc\n");
	});

	it.each([
		[
			"a rename",
			["diff --git a/x b/y", "similarity index 100%", "rename from x", "rename to y"],
		],
		["a binary patch", ["diff --git a/x.png b/x.png", "GIT binary patch", "literal 1"]],
	])("refuses %s", (_, patch) => {
		expect(() => unifiedDiff.parse(patch.join("\n"))).toThrow("not supported");
	});

	it("refuses a hunk with fewer lines than its header says", () => {
		const patch = ["--- a/f.js", "+++ b/f.js", "@@ -1,3 +1,3 @@", " a", "-b", "+c"];

		expect(() => unifiedDiff.parse(patch.join("\n"))).toThrow("cut short");
	});
});
