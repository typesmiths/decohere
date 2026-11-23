/**
 * Each recipe is a working app as it sits in the repo: no scaffolding step, just its own files.
 * Its config is served from memory (vitest.setup.ts swaps node:fs for memfs). It runs as in
 * production, so Pino writes JSON lines to stdout instead of a pretty terminal and a rolled file.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { App } from "@decohere/core/hosting";
import { startTestApp } from "@decohere/http/testing";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Templates } from "./templates.service.js";

const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const recipes = realFs.readdirSync(new Templates().recipesDir);

/** The recipe's config/ folder, in memory where CONFIG_DIR points. */
function serveConfig(recipe: string): string {
	const from = join(new Templates().recipesDir, recipe, "config");
	const to = `/recipes/${recipe}/config`;
	for (const file of realFs.readdirSync(from)) {
		vol.mkdirSync(to, { recursive: true });
		vol.writeFileSync(join(to, file), realFs.readFileSync(join(from, file), "utf8"));
	}
	return to;
}

afterEach(() => {
	vi.unstubAllEnvs();
	resetMemfs();
});

describe.each(recipes)("the %s recipe", (recipe) => {
	it("starts as it is, reads its config and answers GET /hello", async () => {
		vi.stubEnv("CONFIG_DIR", serveConfig(recipe));
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("LOG_LEVEL", "warn");
		const entry = join(new Templates().recipesDir, recipe, "projects/app-name/src/app.ts");
		const { createApp } = (await import(pathToFileURL(entry).href)) as {
			createApp: () => App | Promise<App>;
		};

		await using api = await startTestApp(createApp());
		const hello = await fetch(`${api.baseUrl}/hello`);
		const health = await fetch(`${api.baseUrl}/health`);

		expect(hello.status).toBe(200);
		expect(await hello.json()).toEqual({ message: "Hello from app-name" });
		expect(health.status).toBe(200);
	});
});
