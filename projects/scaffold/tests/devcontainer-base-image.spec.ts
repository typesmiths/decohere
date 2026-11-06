import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AppDevContainerBaseImage } from "../src/models/docker-image.model.js";

const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");

const DOCKERFILE = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../devcontainer/Dockerfile",
);

const BASE = "node:24-trixie-slim";

describe("published app Dev Container base image", () => {
	it("keeps projects/devcontainer/Dockerfile in sync with AppDevContainerBaseImage", () => {
		const expected = new AppDevContainerBaseImage(BASE).build();
		const onDisk = realFs.readFileSync(DOCKERFILE, "utf8");
		const fromIdx = onDisk.indexOf("\nFROM ");
		const body = fromIdx >= 0 ? onDisk.slice(fromIdx + 1) : onDisk;
		expect(body).toBe(expected);
	});

	it("has the Auth0 CLI at a pinned version, and says it has Decohere's tools", () => {
		const content = new AppDevContainerBaseImage(BASE).build();
		expect(content).toMatch(
			/auth0-cli\/v\d+\.\d+\.\d+\/install\.sh \| sh -s -- -b \/usr\/local\/bin v\d+\.\d+\.\d+/,
		);
		expect(content).toContain("ENV DECOHERE_TOOLS=1");
	});

	it("starts from a slim base on a named Debian release", () => {
		const onDisk = realFs.readFileSync(DOCKERFILE, "utf8");
		expect(onDisk).toMatch(/^FROM node:24-trixie-slim$/m);
	});

	it("installs what the slim base leaves out, before the steps that use it", () => {
		const content = new AppDevContainerBaseImage(BASE).build();
		const tools = content.indexOf(
			"apt-get install -y --no-install-recommends ca-certificates curl git less openssh-client procps",
		);
		expect(tools).toBeGreaterThan(-1);
		expect(tools).toBeLessThan(content.indexOf("auth0-cli/"));
	});

	it("leaves its volumes writable by any user ID, because a Dev Container can change node's", () => {
		const content = new AppDevContainerBaseImage(BASE).build();
		expect(content).toContain("chmod 777 /workspace/node_modules");
		expect(content).toContain("chmod -R a+rwX /commandhistory");
	});

	it("includes writable bash history, pnpm, gh, and node user", () => {
		const content = new AppDevContainerBaseImage(BASE).build();
		expect(content).toContain("ENV HISTFILE=/commandhistory/.bash_history");
		expect(content).toContain("chown -R node /commandhistory");
		expect(content).toContain("PROMPT_COMMAND='history -a'");
		expect(content).toContain("pnpm@10");
		expect(content).toContain("apt-get install -y --no-install-recommends gh");
		expect(content).toContain("USER ${USERNAME}");
		expect(content).toContain("bootloader.js");
	});
});
