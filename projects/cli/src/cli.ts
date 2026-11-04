#!/usr/bin/env node
import "./compile-cache.js";
import "./logger.setup.js";
import { scribe } from "@decohere/scribe";
import { cliLogLevel } from "./log-level.js";
import { productCli } from "./product.js";

const configIndex = process.argv.indexOf("--config-file");
const configFile = configIndex !== -1 ? process.argv[configIndex + 1] : undefined;
const logLevelIndex = process.argv.indexOf("--log-level");
const logLevel = logLevelIndex !== -1 ? process.argv[logLevelIndex + 1] : undefined;

scribe.withPinoPretty({
	logLevel: cliLogLevel(logLevel),
	when: "always",
});

const logger = scribe.logger("@decohere/cli");
const app = await productCli.create({ configFile, logLevel });
let exitCode = 0;
try {
	await app.run();
} catch (err) {
	logger.error(err);
	exitCode = 1;
} finally {
	scribe.flush(() => process.exit(exitCode));
}
