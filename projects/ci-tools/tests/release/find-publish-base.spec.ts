import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findPublishBase } from "../../src/release/find-publish-base.mjs";

// The real disk: git runs in a child process, outside the memfs mock.
const { mkdtempSync, rmSync, writeFileSync } =
	await vi.importActual<typeof import("node:fs")>("node:fs");

let repo: string;

function git(...args: string[]) {
	return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function commit(file: string) {
	writeFileSync(path.join(repo, file.replace(/\//g, "-")), file);
	git("add", ".");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", file);
	return git("rev-parse", "HEAD");
}

function init() {
	repo = mkdtempSync(path.join(tmpdir(), "publish-base-"));
	git("init", "-q", "-b", "main");
}

afterEach(() => {
	if (repo) rmSync(repo, { recursive: true, force: true });
});

// Publish decides whether a push carries code by diffing it against this base. The merge queue
// can land a code PR and a docs PR in one push, and CI runs on the docs commit only.
describe("findPublishBase", () => {
	it("is the last shipped commit, not the parent, so code under a docs commit still publishes", () => {
		init();
		const shipped = commit("projects/a.ts");
		git("tag", "v0.0.1-dev.1", shipped);
		commit("projects/b.ts");
		const docs = commit("docs/c.md");

		expect(findPublishBase(docs, repo)).toBe(shipped);
	});

	it("is the parent when nothing has shipped yet", () => {
		init();
		const first = commit("projects/a.ts");
		const second = commit("projects/b.ts");

		expect(findPublishBase(second, repo)).toBe(first);
	});

	it("ignores tags that aren't releases", () => {
		init();
		const shipped = commit("projects/a.ts");
		git("tag", "v0.0.1-dev.1", shipped);
		const other = commit("projects/b.ts");
		git("tag", "bench-baseline", other);
		const docs = commit("docs/c.md");

		expect(findPublishBase(docs, repo)).toBe(shipped);
	});

	it("is undefined for a first commit", () => {
		init();
		const first = commit("projects/a.ts");

		expect(findPublishBase(first, repo)).toBeUndefined();
	});
});
