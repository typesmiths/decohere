import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { KeyedModel, SourceFile } from "../../models/source-file.js";

const GREETING = "Hello from a test";

/**
 * Model for `projects/<api>/tests/hello.controller.spec.ts`: a test that boots the Hello
 * controller on its own, with only the services it needs, and calls it over HTTP. It needs no
 * database, network or Docker, so it passes in a fresh project.
 *
 * Features call addImport / addService / addPlugin / stubEnv for what they add to the controller.
 */
export class HelloSpecFile implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.HELLO_SPEC;

	private readonly _imports = new Set<string>();
	private readonly _services: string[] = ["services.registerSingleton(SampleService);"];
	private readonly _plugins: string[] = ["config(EnvDataSource)"];
	private readonly _env: [name: string, value: string][] = [["SAMPLE__GREETING", GREETING]];

	/** Adds a named import, e.g. `import { auth } from "@decohere/http"`. */
	public addImport(name: string, from: string): this {
		this._imports.add(`import { ${name} } from "${from}";`);
		return this;
	}

	/** Adds a statement to the `services` callback, which gets `services`. */
	public addService(...lines: string[]): this {
		this._services.push(lines.join("\n"));
		return this;
	}

	/** Adds a plugin to the builder, e.g. `auth()`. */
	public addPlugin(call: string): this {
		this._plugins.push(call);
		return this;
	}

	/** Sets an environment variable for the test, e.g. a config value. */
	public stubEnv(name: string, value: string): this {
		this._env.push([name, value]);
		return this;
	}

	public files(): SourceFile[] {
		const content = [
			'import { config, EnvDataSource } from "@decohere/config";',
			'import { bootModule } from "@decohere/http/testing";',
			'import { afterEach, expect, it, vi } from "vitest";',
			'import { HelloController } from "../src/controllers/hello.controller.js";',
			'import { SampleService } from "../src/services/sample.service.js";',
			...this._imports,
			"",
			"afterEach(() => {",
			"\tvi.unstubAllEnvs();",
			"});",
			"",
			"// The Hello controller on its own, as a real app on a free port. To test the whole app",
			"// instead: `await using api = await startTestApp(createApp());`",
			'it("GET /hello answers with the greeting from config", async () => {',
			...this._env.map(
				([name, value]) => `\tvi.stubEnv(${JSON.stringify(name)}, ${JSON.stringify(value)});`,
			),
			"\tawait using api = await bootModule({",
			"\t\tcontrollers: [HelloController],",
			"\t\tservices: (services) => {",
			...this._services.flatMap((service) =>
				service.split("\n").map((line) => `\t\t\t${line}`),
			),
			"\t\t},",
			`\t\tconfigure: (builder) => builder${this._plugins.map((plugin) => `.use(${plugin})`).join("")},`,
			"\t});",
			"",
			"\tconst response = await fetch(`${api.baseUrl}/hello`);",
			"",
			"\texpect(response.status).toBe(200);",
			`\texpect(await response.json()).toEqual({ message: ${JSON.stringify(GREETING)} });`,
			"});",
			"",
		].join("\n");
		return [{ filePath: "tests/hello.controller.spec.ts", content }];
	}
}
