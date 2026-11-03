import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	DevContainerImageModel,
	DockerfileModel,
	DockerStep,
	withGithubCli,
	withPnpm,
	withPostgresqlClient,
} from "../src/models/docker-image.model.js";
import { WebapiProductionDockerfile } from "../src/webapi/models/production-dockerfile.model.js";
import { WebapiDevContainer } from "../src/webapi/models/webapi-image.model.js";

describe("DockerfileModel", () => {
	it("supports from() and entrypoint() with entrypoint rendered at the end", () => {
		const dockerfile = new DockerfileModel("node:24").from("debian:bookworm");
		dockerfile.entrypoint(["node", "/app/index.js"]);

		const content = dockerfile.build();
		expect(content).toContain("FROM debian:bookworm");
		expect(content.trimEnd().endsWith('ENTRYPOINT ["node","/app/index.js"]')).toBe(true);
	});

	it("generic image model writes Dockerfile at project root", () => {
		const dockerfile = new DockerfileModel("node:24");
		const files = dockerfile.files();

		expect(files).toHaveLength(1);
		expect(files[0]?.filePath).toBe("./Dockerfile");
	});

	it("base model is generic and has no devcontainer defaults", () => {
		const dockerfile = new DockerfileModel("node:24");
		const content = dockerfile.build();

		expect(content).toContain("FROM node:24");
		expect(content).not.toContain("ENV HISTFILE=/commandhistory/.bash_history");
		expect(content).not.toContain("pnpm@10");
		expect(content).not.toContain("bootloader.js");
	});

	it("devcontainer subtype adds command history and vscode bootloader fix", () => {
		const dockerfile = new DevContainerImageModel("node:24");
		const content = dockerfile.build();
		const files = dockerfile.files();

		expect(content).toContain("ENV HISTFILE=/commandhistory/.bash_history");
		expect(content).toContain("chown -R node /commandhistory");
		expect(content).toContain("PROMPT_COMMAND='history -a'");
		expect(content).toContain("bootloader.js");
		expect(files).toHaveLength(1);
		expect(files[0]?.filePath).toBe(".devcontainer/Dockerfile");
	});

	it("applies string layers as RUN steps", () => {
		const dockerfile = new DockerfileModel("node:24");
		dockerfile.addLayer("echo hello-world");

		const content = dockerfile.build();
		expect(content).toContain("RUN echo hello-world");
	});

	it("executes layer writers at build and sorts keyed steps by order", () => {
		const dockerfile = new DockerfileModel("node:24");
		dockerfile.addLayer((df) => {
			df.addStep(DockerStep.run("ordered-b", "echo second", 2_001));
			df.addStep(DockerStep.run("ordered-a", "echo first", 2_000));
		});

		const content = dockerfile.build();
		expect(content.indexOf("RUN echo first")).toBeLessThan(content.indexOf("RUN echo second"));
	});

	it("uses keyed upsert semantics when multiple layers write the same step key", () => {
		const dockerfile = new DockerfileModel("node:24");
		dockerfile.addLayer((df) => {
			df.addStep(DockerStep.run("replace-me", "echo old", 2_000));
		});
		dockerfile.addLayer((df) => {
			df.addStep(DockerStep.run("replace-me", "echo new", 2_000));
		});

		const content = dockerfile.build();
		expect(content).not.toContain("RUN echo old");
		expect(content).toContain("RUN echo new");
	});

	it("supports reusable layer writers", () => {
		const dockerfile = new DockerfileModel("node:24");
		dockerfile.addLayer(withPnpm({ version: "9" }));

		const content = dockerfile.build();
		expect(content).toContain("pnpm@9");
	});

	it("withPostgresqlClient escalates to root so it works on a published base image", () => {
		const dockerfile = new DockerfileModel("node:24");
		dockerfile.addLayer(withPostgresqlClient());

		const content = dockerfile.build();
		expect(content).toContain("USER root");
		expect(content).toContain("postgresql-client");
		expect(content).toContain("apt-get install");
		expect(content).toContain("USER node");
	});

	it("withGithubCli installs gh before USER", () => {
		const dockerfile = new DockerfileModel("node:24");
		dockerfile.addLayer(withGithubCli());

		const content = dockerfile.build();
		expect(content).toContain("apt-get install -y --no-install-recommends gh");
	});

	it("webapi production dockerfile copies the packaged app and runs it with node", () => {
		const files = new WebapiProductionDockerfile().files();
		const docker = files.find((f) => f.filePath === "projects/api/Dockerfile");
		expect(docker?.content).toContain("COPY .package/ ./");
		expect(docker?.content).toContain('CMD ["node", "es6/src/main.js"]');
		expect(docker?.content).toContain("FROM node:24-bookworm-slim");
		expect(files.map((f) => f.filePath).sort()).toEqual([
			"projects/api/.dockerignore",
			"projects/api/Dockerfile",
		]);
	});

	it("webapi production dockerfile installs nothing and needs no npm token or build tooling", () => {
		const docker = new WebapiProductionDockerfile()
			.files()
			.find((f) => f.filePath === "projects/api/Dockerfile");
		const instructions = (docker?.content ?? "")
			.split("\n")
			.filter((line) => /^[A-Z]+ /.test(line));
		expect(instructions.some((line) => line.startsWith("RUN"))).toBe(false);
		expect(docker?.content).not.toMatch(/pnpm install|npm install|corepack/);
		expect(docker?.content).not.toContain("npm_token");
		expect(docker?.content).not.toContain("NODE_AUTH_TOKEN");
	});

	it("webapi production dockerfile builds from the project folder, which holds only .package", () => {
		const ignore = new WebapiProductionDockerfile()
			.files()
			.find((f) => f.filePath === "projects/api/.dockerignore");
		expect(ignore?.content).toBe("*\n!.package\n");
	});

	it("emits one Dockerfile in each API's own folder", () => {
		const files = new WebapiProductionDockerfile(["api", "billing"]).files();
		expect(files.map((f) => f.filePath).filter((p) => p.endsWith("/Dockerfile"))).toEqual([
			"projects/api/Dockerfile",
			"projects/billing/Dockerfile",
		]);
		const billing = files.find((f) => f.filePath === "projects/billing/Dockerfile");
		expect(billing?.content).toContain("pnpm run package:billing");
		expect(billing?.content).toContain("docker build -t billing projects/billing");
	});

	it("webapi scaffold Dockerfile is a thin FROM the published base image", () => {
		const dockerfile = new WebapiDevContainer();
		const content = dockerfile.build();
		const files = dockerfile.files();

		expect(content).toMatch(/^FROM ghcr\.io\/typesmiths\/decohere\/devcontainer:/);
		expect(content).not.toContain("pnpm@10");
		expect(content).not.toContain("bootloader.js");
		expect(files).toHaveLength(1);
		expect(files[0]?.filePath).toBe(".devcontainer/Dockerfile");
	});
});

describe("DockerfileModel.fromFile appends feature layers to an existing Dockerfile", () => {
	const path = "/Dockerfile";

	it("appends the whole layer even when part of it already appears", () => {
		writeFileSync(path, "FROM base\n\nUSER root\nRUN echo hi\nUSER node\n");
		const content = DockerfileModel.fromFile(path, ".devcontainer/Dockerfile")
			.addLayer(withPostgresqlClient())
			.build();
		expect(content).toBe(
			"FROM base\n\nUSER root\nRUN echo hi\nUSER node\n\nUSER root\n\nRUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*\n\nUSER node\n",
		);
	});

	it("leaves the file unchanged when the layer is already there", () => {
		const once =
			"FROM base\n\nUSER root\n\nRUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*\n\nUSER node\n";
		writeFileSync(path, once);
		const content = DockerfileModel.fromFile(path, ".devcontainer/Dockerfile")
			.addLayer(withPostgresqlClient())
			.build();
		expect(content).toBe(once);
	});
});
