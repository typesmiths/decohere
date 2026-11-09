import { CommandResponse } from "@decohere/devkit/cli";
import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { productCli } from "../src/product.js";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
	vi.spyOn(process.stdout, "write").mockReturnValue(true);
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

function names(commands: readonly { name(): string }[]): string[] {
	return commands.map((c) => c.name());
}

describe("product CLI shape", () => {
	it("ships forge, flux, create webapi, add api, auth0 and db together", async () => {
		const app = await productCli.create();
		expect(names(app.commands)).toEqual(["forge", "flux", "create", "add", "auth0", "db"]);

		const forge = app.commands.find((c) => c.name() === "forge");
		expect(names(forge?.commands ?? [])).toEqual(
			expect.arrayContaining([
				"build",
				"docker",
				"publish",
				"dependencies",
				"version",
				"tag",
				"link",
				"unlink",
				"typecheck",
			]),
		);

		const flux = app.commands.find((c) => c.name() === "flux");
		expect(names(flux?.commands ?? [])).toEqual(expect.arrayContaining(["serve", "run"]));

		const create = app.commands.find((c) => c.name() === "create");
		expect(names(create?.commands ?? [])).toEqual(["webapi"]);

		const add = app.commands.find((c) => c.name() === "add");
		expect(names(add?.commands ?? [])).toEqual(["api", "auth0"]);

		const auth0 = app.commands.find((c) => c.name() === "auth0");
		expect(names(auth0?.commands ?? [])).toEqual(["login", "configure", "token"]);
	});

	it.each([
		[["--help"]],
		[["forge", "--help"]],
		[["flux", "--help"]],
		[["create", "--help"]],
		[["create", "webapi", "--help"]],
		[["add", "--help"]],
		[["add", "api", "--help"]],
		[["add", "auth0", "--help"]],
		[["auth0", "--help"]],
		[["auth0", "login", "--help"]],
		[["auth0", "configure", "--help"]],
		[["auth0", "token", "--help"]],
		[["db", "--help"]],
	] as const)("routes decohere %s", async (argv) => {
		const app = await productCli.create();
		await expect(app.run([...argv])).resolves.toEqual(CommandResponse.help());
	});
});

describe("commands on an existing project", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it.each([
		[["add", "api", "billing"]],
		[["add", "auth0"]],
		[["auth0", "login"]],
		[["auth0", "configure"]],
		[["auth0", "token"]],
	])("%j says to open the Dev Container when the tools aren't here", async (argv) => {
		vi.stubEnv("DECOHERE_TOOLS", "");
		const app = await productCli.create();

		await expect(app.run([...argv])).rejects.toThrow("Dev Container");
	});

	it("runs the command itself when the tools are here", async () => {
		vi.stubEnv("DECOHERE_TOOLS", "1");
		const app = await productCli.create();

		await expect(app.run(["add", "api", ""])).rejects.toThrow("API name is required");
	});
});
