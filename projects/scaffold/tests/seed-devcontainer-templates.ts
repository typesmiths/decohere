import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { vol } from "memfs";
import { vi } from "vitest";
import { devcontainerTemplatePath } from "../src/webapi/devcontainer/host-scripts.js";

const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");

const TEMPLATE_NAMES = ["initialize.sh", "post-create.sh"] as const;

/** Copy Dev Container templates into memfs so scaffold can read them after `resetMemfs`. */
export function seedDevcontainerTemplates(): void {
	const files = TEMPLATE_NAMES.map((name) => ({
		mem: devcontainerTemplatePath(name),
		disk: fileURLToPath(
			new URL(`../src/webapi/devcontainer/templates/${name}`, import.meta.url),
		),
	}));
	for (const { mem, disk } of files) {
		vol.mkdirSync(dirname(mem), { recursive: true });
		vol.writeFileSync(mem, realFs.readFileSync(disk, "utf8"));
	}
}
