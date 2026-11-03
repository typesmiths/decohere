import { mkdirSync, writeFileSync } from "node:fs";
import { resetMemfs } from "@decohere/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { findWorkspaceRoot } from "../src/factories/find-workspace-root.js";

describe("findWorkspaceRoot", () => {
	beforeEach(() => {
		resetMemfs();
		mkdirSync("/ws/projects/api/src", { recursive: true });
		writeFileSync("/ws/package.json", "{}");
		writeFileSync("/ws/projects/api/package.json", "{}");
	});

	it("finds the root from a package directory below it", () => {
		expect(findWorkspaceRoot("/ws/projects/api/src")).toBe("/ws");
	});

	it("returns the root itself", () => {
		expect(findWorkspaceRoot("/ws")).toBe("/ws");
	});

	it("skips a package.json that has no projects/ folder (a package, not the root)", () => {
		expect(findWorkspaceRoot("/ws/projects/api")).toBe("/ws");
	});

	it("falls back to the start directory outside any workspace", () => {
		mkdirSync("/elsewhere/deep", { recursive: true });
		expect(findWorkspaceRoot("/elsewhere/deep")).toBe("/elsewhere/deep");
	});
});
