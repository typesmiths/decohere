import { join } from "node:path";
import { vol } from "memfs";
import { vi } from "vitest";
import { templates } from "../src/templates/templates.js";

const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");

/** Copies the scaffolder's templates into memfs, where it reads them in a test. */
export function seedTemplates(dir = templates.dir()): void {
	for (const entry of realFs.readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			seedTemplates(path);
			continue;
		}
		vol.mkdirSync(dir, { recursive: true });
		vol.writeFileSync(path, realFs.readFileSync(path));
	}
}
