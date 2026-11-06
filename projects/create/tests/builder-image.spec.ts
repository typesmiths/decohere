/**
 * Builder image must ship `decohere` and must not `npm exec` it from the
 * registry at runtime (stale prefer-offline packuments yield ETARGET).
 */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const fs = await vi.importActual<typeof import("node:fs")>("node:fs");

const ENTRYPOINT = fileURLToPath(new URL("../docker-entrypoint.sh", import.meta.url));
const DOCKERFILE = fileURLToPath(new URL("../Dockerfile", import.meta.url));

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

type Harness = {
	bin: string;
	home: string;
	log: string;
};

function writeExec(path: string, body: string): void {
	fs.writeFileSync(path, body);
	fs.chmodSync(path, 0o755);
}

function harness(options: { createBin: boolean; npmInstallsCreate?: boolean }): Harness {
	const dir = fs.mkdtempSync(join(tmpdir(), "create-builder-"));
	tempDirs.push(dir);
	const bin = join(dir, "bin");
	const home = join(dir, "home");
	fs.mkdirSync(bin);
	fs.mkdirSync(home);
	const log = join(dir, "commands.log");
	fs.writeFileSync(log, "");

	const installSnippet = options.npmInstallsCreate
		? `cat > "${bin}/decohere" <<'EOF'
#!/bin/sh
echo "decohere $*" >> "${log}"
EOF
chmod 755 "${bin}/decohere"
exit 0
`
		: "exit 42\n";

	writeExec(
		join(bin, "npm"),
		`#!/bin/sh
echo "npm $*" >> "${log}"
${installSnippet}`,
	);

	if (options.createBin) {
		writeExec(
			join(bin, "decohere"),
			`#!/bin/sh
echo "decohere $*" >> "${log}"
`,
		);
	}

	return { bin, home, log };
}

function runEntrypoint(h: Harness, args: string[], extraEnv: Record<string, string> = {}) {
	return spawnSync("sh", [ENTRYPOINT, ...args], {
		encoding: "utf8",
		env: {
			PATH: `${h.bin}:/usr/bin:/bin`,
			HOME: h.home,
			...extraEnv,
		},
	});
}

describe("builder image", () => {
	it("installs create.tgz into the image at build time", () => {
		const dockerfile = fs.readFileSync(DOCKERFILE, "utf8");
		expect(dockerfile).toContain("COPY create.tgz");
		expect(dockerfile).toMatch(/tar -xzf .*create\.tgz/);
		expect(dockerfile).toContain("@decohere/scaffold");
		expect(dockerfile).toContain("/usr/local/bin/decohere");
		expect(dockerfile).not.toMatch(/npm install -g --offline/);
		expect(dockerfile).not.toContain("npm_token");
		expect(dockerfile).not.toContain("npm exec");
	});

	it("does not ship CLI libraries on the host package", () => {
		const pkg = JSON.parse(
			fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
		) as { dependencies?: Record<string, string> };
		expect(pkg.dependencies ?? {}).toEqual({});
		expect(JSON.stringify(pkg)).not.toContain("@decohere/core");
		expect(JSON.stringify(pkg)).not.toContain("openapi-to-postmanv2");
	});

	it("runs the baked-in decohere binary without calling npm", () => {
		const h = harness({ createBin: true });
		const result = runEntrypoint(h, ["create", "webapi", "-d", "."]);

		expect(result.status, result.stderr).toBe(0);
		expect(fs.readFileSync(h.log, "utf8")).toBe("decohere create webapi -d .\n");
	});

	it("does not npm exec @decohere/create from the registry when the binary is missing", () => {
		const h = harness({ createBin: false });
		const result = runEntrypoint(h, ["webapi", "-d", "."], { CREATE_VERSION: "0.0.1-dev.44" });

		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/decohere is not installed/i);
		expect(fs.readFileSync(h.log, "utf8")).not.toMatch(/npm exec/);
		expect(fs.readFileSync(h.log, "utf8")).not.toContain("@decohere/create@");
	});

	it("runs as a non-root user, and owns the folder it writes to", () => {
		const dockerfile = fs.readFileSync(DOCKERFILE, "utf8");
		expect(dockerfile).toContain("chown node:node /workspace");
		expect(dockerfile).toMatch(/^USER node$/m);
	});

	it("pins the same Auth0 CLI version as the Dev Container", () => {
		const version = (file: string) =>
			fs.readFileSync(file, "utf8").match(/auth0-cli\/(v\d+\.\d+\.\d+)\/install\.sh/)?.[1];
		const devContainer = fileURLToPath(
			new URL("../../devcontainer/Dockerfile", import.meta.url),
		);
		expect(version(DOCKERFILE)).toBeDefined();
		expect(version(DOCKERFILE)).toBe(version(devContainer));
	});
});
