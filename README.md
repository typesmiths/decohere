<div align="center">

<h1 align="center">Decohere</h1>

<p><strong>TypeScript framework and toolchain for Node.js backends.</strong></p>

<p>
  <a href="https://www.npmjs.com/package/@decohere/cli"><img src="https://img.shields.io/npm/v/@decohere/cli.svg?style=for-the-badge&label=npm" alt="npm version"></a>
  <a href="https://github.com/typesmiths/decohere/actions/workflows/ci.yml?query=branch%3Amain"><img src="https://img.shields.io/github/actions/workflow/status/typesmiths/decohere/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@decohere/cli.svg?style=for-the-badge" alt="License"></a>
  <a href="https://github.com/typesmiths/decohere"><img src="https://img.shields.io/github/stars/typesmiths/decohere?style=for-the-badge&logo=github" alt="GitHub stars"></a>
</p>

<br />

[**Docs**](docs/) &nbsp;&bull;&nbsp; [**Getting started**](docs/getting-started.md) &nbsp;&bull;&nbsp; [**Recipes**](docs/recipes/) &nbsp;&bull;&nbsp; [**Why Decohere**](docs/why-decohere.md)

<br />

</div>

Decohere takes you from a single TypeScript file to a production Node API without the setup tax. Run a file with no config. Scaffold a complete API with logging, tests, CI and Docker already wired, plus auth and Postgres if you want them. Ship it with the same toolchain that ran it on day one.

## Quick Start

```bash
pnpm create @decohere webapi -d orders
cd orders
pnpm dev
```

### Or just run a file

```bash
npm init -y && npm pkg set type=module
npm i -D @decohere/cli
```

Save this as `app.ts`. Enums, decorators and parameter properties all need more than removing types:

```ts
enum Level {
	Info = "info",
}

function log(_target: unknown, name: string, descriptor: PropertyDescriptor) {
	const original = descriptor.value;
	descriptor.value = function (...args: unknown[]) {
		console.log(`[${Level.Info}] ${name}(${args.join(", ")})`);
		return original.apply(this, args);
	};
}

class Greeter {
	constructor(private readonly greeting: string) {}

	@log
	greet(name: string) {
		return `${this.greeting}, ${name}!`;
	}
}

console.log(new Greeter("Hello").greet("Ada"));
```

```console
$ node app.ts
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode

$ npx flux run app.ts
[info] greet(Ada)
Hello, Ada!
```

No `tsconfig.json`, no build step, and flux itself starts in about 150 ms. The [getting started guide](docs/getting-started.md) walks through both.

## Why Decohere?

- **Run TypeScript as it is -** [Flux](projects/flux/README.md) runs a single file or a whole app straight from source and reloads on save. No build step, no config, no module-format decisions.
- **A production API in one command -** [`create`](projects/create/README.md) scaffolds an app with logging, health routes, tests, linting, CI and Dockerfiles already wired, plus Postgres and Auth0 if you want them.
- **One toolchain from first file to deploy -** [Forge](projects/forge/README.md) builds, tests, versions, containerizes and publishes on the same SWC pipeline Flux runs on.
- **A framework with defaults you can swap -** HTTP, dependency injection, config, logging, auth and data, on Fastify, Pino, Postgres and Auth0. [Learn more &raquo;](docs/architecture/)
- **Adopt one piece at a time -** Add Forge or Flux to the workspace you already have; the framework is optional. [Learn more &raquo;](docs/recipes/)

How it compares with NestJS and Nx: [Why Decohere &raquo;](docs/why-decohere.md)

## Want to help?

To file a bug or open a pull request, read the [contributing guide](.github/CONTRIBUTING.md) and the [code of conduct](.github/CODE_OF_CONDUCT.md). Report security issues as described in [SECURITY.md](.github/SECURITY.md).

## License

[ISC](LICENSE) © Typesmiths
