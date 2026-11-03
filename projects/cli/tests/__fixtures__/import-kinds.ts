/**
 * A workspace whose app imports in every way a TypeScript app does: a package name, a package
 * subpath naming a directory, an extensionless file, a directory, a tsconfig `paths` alias, and
 * a dynamic `import()`. Shared by the flux and forge real-process tests: flux resolves
 * these in its resolve hook, a debug build rewrites them into the emitted JavaScript.
 *
 * Plain data, so each test writes it with the real `fs` (unit tests mock `node:fs`).
 */
export const importKindsWorkspace: Record<string, string> = {
	"package.json": JSON.stringify({ name: "ws", private: true, type: "module" }),
	"tsconfig.json": JSON.stringify({
		compilerOptions: {
			experimentalDecorators: true,
			paths: { "@app/*": ["projects/app/src/*"] },
		},
	}),
	"projects/lib/package.json": JSON.stringify({
		name: "@ws/lib",
		type: "module",
		main: "src/index.ts",
	}),
	"projects/lib/src/index.ts": `export const lib = "lib";\n`,
	"projects/lib/src/models/index.ts": `export const model = "model";\n`,
	"projects/app/package.json": JSON.stringify({
		name: "@ws/app",
		type: "module",
		main: "src/main.ts",
	}),
	"projects/app/src/util.ts": `export const util = "util";\n`,
	"projects/app/src/shared/greeting.ts": `export const greeting = "hello";\n`,
	"projects/app/src/parts/index.ts": `export const part = "part";\n`,
	"projects/app/src/main.ts": [
		`import { lib } from "@ws/lib";`,
		`import { model } from "@ws/lib/models";`,
		`import { util } from "./util";`,
		`import { part } from "./parts";`,
		`import { greeting } from "@app/shared/greeting";`,
		`const tag = (_target: unknown) => {};`,
		`@tag`,
		`class Decorated {}`,
		`const later = await import("@ws/lib/models");`,
		`console.log(JSON.stringify({ lib, model, util, part, greeting, decorated: Decorated.name, later: later.model }));`,
	].join("\n"),
};

/** What `main.ts` prints when every import resolved. */
export const importKindsOutput = {
	lib: "lib",
	model: "model",
	util: "util",
	part: "part",
	greeting: "hello",
	decorated: "Decorated",
	later: "model",
};
