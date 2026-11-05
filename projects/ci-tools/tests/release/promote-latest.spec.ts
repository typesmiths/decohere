import { describe, expect, it } from "vitest";
import { promoteLatest } from "../../src/release/promote-latest.mjs";

const VERSION = "0.0.1-dev.20261105.64";
const PUBLISHED = Date.parse("2026-11-05T10:50:00Z");
const DAY_LATER = PUBLISHED + 25 * 60 * 60 * 1000;
const PACKAGES = ["@decohere/cli", "@decohere/core"];

type Registry = {
	dev?: string;
	versions?: Record<string, string[]>;
	latest?: Record<string, string>;
	tags?: string[];
	failMoving?: string[];
	moves?: string[];
};

function fakeRun(registry: Registry) {
	const versions = registry.versions ?? {
		"@decohere/cli": [VERSION],
		"@decohere/core": [VERSION],
	};
	const latest = registry.latest ?? { "@decohere/cli": "old", "@decohere/core": "old" };
	const moves: string[] = (registry.moves ??= []);
	return (command: string, args: string[]) => {
		const ok = (stdout = "") => ({ status: 0, stdout });
		if (command === "git") return ok((registry.tags ?? [`v${VERSION}`]).join("\n"));
		const [verb, sub, third] = args;
		if (verb === "view" && sub === "@decohere/cli" && third === "dist-tags.dev") {
			return ok(registry.dev ?? "");
		}
		if (verb === "view" && third === "version") {
			const [, name, version] = /^(.+)@(.+)$/.exec(sub ?? "") ?? [];
			return ok(versions[name ?? ""]?.includes(version ?? "") ? `${version}\n` : "");
		}
		if (verb === "view" && third === "time") {
			return ok(JSON.stringify({ [VERSION]: new Date(PUBLISHED).toISOString() }));
		}
		if (verb === "dist-tag" && sub === "ls")
			return ok(`dev: x\nlatest: ${latest[third ?? ""]}\n`);
		if (verb === "dist-tag" && sub === "add") {
			const [, name, version] = /^(.+)@(.+)$/.exec(third ?? "") ?? [];
			if (registry.failMoving?.includes(name ?? "")) return { status: 1, stdout: "" };
			moves.push(name ?? "");
			latest[name ?? ""] = version ?? "";
			return ok();
		}
		throw new Error(`Unexpected: ${command} ${args.join(" ")}`);
	};
}

function promote(
	registry: Registry,
	options: { version?: string; allowYoung?: boolean; now?: number },
) {
	const messages: string[] = [];
	const code = promoteLatest({
		version: options.version,
		allowYoung: options.allowYoung,
		packages: PACKAGES,
		run: fakeRun(registry),
		now: () => options.now ?? DAY_LATER,
		log: (message: string) => messages.push(message),
	});
	return { code, output: messages.join("\n"), moves: registry.moves ?? [] };
}

describe("promoteLatest", () => {
	it("moves latest on every package", () => {
		const { code, moves } = promote({}, { version: VERSION });

		expect(code).toBe(0);
		expect(moves).toEqual(PACKAGES);
	});

	it("uses what dev points at when no version is given", () => {
		const { code, moves } = promote({ dev: VERSION }, {});

		expect(code).toBe(0);
		expect(moves).toEqual(PACKAGES);
	});

	it("refuses to replace a stable latest with a dev version, moving nothing", () => {
		const { code, output, moves } = promote(
			{ latest: { "@decohere/cli": "0.1.0", "@decohere/core": "0.1.0" } },
			{ version: VERSION },
		);

		expect(code).toBe(1);
		expect(output).toContain("latest is the stable 0.1.0");
		expect(moves).toEqual([]);
	});

	it("refuses a version without a v* tag, moving nothing", () => {
		const { code, output, moves } = promote({ tags: [] }, { version: VERSION });

		expect(code).toBe(1);
		expect(output).toContain("no v0.0.1-dev.20261105.64 tag");
		expect(moves).toEqual([]);
	});

	it("refuses a version missing from any package, naming it and moving nothing", () => {
		const { code, output, moves } = promote(
			{ versions: { "@decohere/cli": [VERSION], "@decohere/core": [] } },
			{ version: VERSION },
		);

		expect(code).toBe(1);
		expect(output).toContain("@decohere/core");
		expect(moves).toEqual([]);
	});

	it("refuses a version under a day old, moving nothing", () => {
		const { code, output, moves } = promote(
			{},
			{ version: VERSION, now: PUBLISHED + 3_600_000 },
		);

		expect(code).toBe(1);
		expect(output).toContain("1.0 hours old");
		expect(moves).toEqual([]);
	});

	it("allows a young version when told to", () => {
		const { code, moves } = promote(
			{},
			{ version: VERSION, now: PUBLISHED + 3_600_000, allowYoung: true },
		);

		expect(code).toBe(0);
		expect(moves).toEqual(PACKAGES);
	});

	it("skips packages already there, so it can be run again", () => {
		const { code, moves } = promote(
			{ latest: { "@decohere/cli": VERSION, "@decohere/core": "old" } },
			{ version: VERSION },
		);

		expect(code).toBe(0);
		expect(moves).toEqual(["@decohere/core"]);
	});

	it("keeps going past a failure, then fails naming the package", () => {
		const { code, output, moves } = promote(
			{ failMoving: ["@decohere/cli"] },
			{ version: VERSION },
		);

		expect(code).toBe(1);
		expect(output).toContain("Failed to move: @decohere/cli");
		expect(moves).toEqual(["@decohere/core"]);
	});
});
