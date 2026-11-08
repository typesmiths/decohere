import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDevcontainerTemplates } from "./seed-devcontainer-templates.js";

/**
 * Contract: a generated app installs the ORM version its provider package is built on. The
 * app's entities are decorated by the ORM it installs and read by the provider's copy, so two
 * major versions side by side means the provider finds no entities.
 */

const mockPm = {
	name: "pnpm" as const,
	install: vi.fn().mockResolvedValue({ message: "", data: [] }),
	syncLockFile: vi.fn().mockResolvedValue({ message: "", data: [] }),
};

vi.mock(import("../../devkit/src/interop/index.js"), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		detectPackageManager: () => mockPm,
		promptForPackageManager: () => Promise.resolve(mockPm),
	};
});

vi.mock("../src/webapi/features/format-files.js", () => ({
	formatScaffoldedFiles: vi.fn(),
}));

const { scaffoldApi } = await import("../src/webapi/create-api.js");

// The provider package's own manifest, from the real disk (fs is memfs in this suite).
const { readFileSync: readRealFile } =
	await vi.importActual<typeof import("node:fs")>("node:fs");
const providerManifest = JSON.parse(
	readRealFile(new URL("../../data/data-typeorm/package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
	vi.stubEnv("DECOHERE_BUILDER", "1");
	resetMemfs();
	seedDevcontainerTemplates();
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("a generated app's ORM ↔ its provider package", () => {
	it("installs the TypeORM range data-typeorm depends on", async () => {
		await scaffoldApi({
			d: "/my-app",
			names: ["api"],
			databaseProvider: "postgres/typeorm",
			authProvider: "none",
			installDependencies: "no",
		});

		const app = JSON.parse(readFileSync(join("/my-app", "package.json"), "utf8")) as {
			dependencies: Record<string, string>;
		};
		expect(app.dependencies.typeorm).toBe(providerManifest.dependencies.typeorm);
	});
});

describe("a generated Postgres app ↔ @decohere/data-postgres", () => {
	it("installs it and passes its bootstrap to the provider, since dev config asks for setup", async () => {
		await scaffoldApi({
			d: "/my-app",
			names: ["api"],
			databaseProvider: "postgres/typeorm",
			authProvider: "none",
			installDependencies: "no",
		});

		const app = JSON.parse(readFileSync(join("/my-app", "package.json"), "utf8")) as {
			dependencies: Record<string, string>;
		};
		expect(app.dependencies).toHaveProperty("@decohere/data-postgres");
		const main = readFileSync(join("/my-app", "projects/api/src/main.ts"), "utf8");
		expect(main).toContain('import { postgres } from "@decohere/data-postgres";');
		expect(main).toMatch(/typeOrm\(\{[^)]*bootstrap: postgres\.bootstrap/);
	});
});
