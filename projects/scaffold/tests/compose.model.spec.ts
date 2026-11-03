import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DockerCompose } from "../src/models/compose.model.js";

describe("DockerCompose SSRF/exposure hardening helpers", () => {
	it("renders loopback-bound ports and optional profiles", () => {
		const compose = new DockerCompose()
			.setProjectName("webapi")
			.addService("postgres", {
				image: "postgres:16",
				ports: ["127.0.0.1:5433:5432"],
			})
			.addService("adminer", {
				image: "adminer",
				profiles: ["tools"],
				ports: ["127.0.0.1:8081:8080"],
			});

		const yaml = compose.getContent();
		expect(yaml).toContain('ports:\n      - "127.0.0.1:5433:5432"');
		expect(yaml).toContain("profiles:\n      - tools");
		expect(yaml).toContain('ports:\n      - "127.0.0.1:8081:8080"');
		expect(yaml).not.toMatch(/ports:\n\s+- "5433:5432"/);
		expect(yaml).not.toMatch(/ports:\n\s+- "8081:8080"/);
	});

	it("renders header comments and bind mounts without a named volumes section", () => {
		const yaml = new DockerCompose()
			.addHeaderComment("Bind mount dies with the working tree.")
			.addService("postgres", {
				image: "postgres:16",
				volumes: ["./postgres-data:/var/lib/postgresql/data"],
			})
			.getContent();

		expect(yaml.startsWith("# Bind mount dies with the working tree.")).toBe(true);
		expect(yaml).toContain("./postgres-data:/var/lib/postgresql/data");
		expect(yaml).not.toMatch(/^volumes:\s*$/m);
	});

	it("quotes compose user so 0:0 is not parsed as a number", () => {
		const yaml = new DockerCompose()
			.addService("devcontainer", {
				build: ".",
				user: "0:0",
				command: "sleep infinity",
			})
			.getContent();

		expect(yaml).toContain('user: "0:0"');
	});
});

describe("DockerCompose.fromFile merges into a hand-edited compose file", () => {
	it("keeps comments and existing services, and turns a single env_file into a list", () => {
		writeFileSync(
			"/compose.yml",
			"# mine\nservices:\n  app:\n    image: node # pinned\n    env_file: ./a.env\n",
		);
		const content = DockerCompose.fromFile("/compose.yml")
			.addService("app", { image: "replaced" })
			.addService("db", { image: "postgres" })
			.addEnvFile("app", "../.env")
			.addEnvFile("app", "./a.env")
			.getContent();

		expect(content).toBe(
			"# mine\nservices:\n  app:\n    image: node # pinned\n    env_file:\n      - ./a.env\n      - ../.env\n  db:\n    image: postgres\n",
		);
	});
});
