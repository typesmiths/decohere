import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SourceFile, SourceFileProvider } from "../../models/source-file.js";

const TEMPLATE_FILES = ["initialize.sh", "post-create.sh"] as const;

export function devcontainerTemplatePath(name: string): string {
	return fileURLToPath(new URL(`./templates/${name}`, import.meta.url));
}

/** Host + container scripts for the scaffolded Dev Container. */
export class DevContainerHostScripts implements SourceFileProvider {
	public files(): SourceFile[] {
		return TEMPLATE_FILES.map((name) => ({
			filePath: `.devcontainer/${name}`,
			content: readFileSync(devcontainerTemplatePath(name), "utf8"),
		}));
	}
}
