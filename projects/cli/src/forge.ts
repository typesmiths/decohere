#!/usr/bin/env node
import "./logger.setup.js";
import { ForgeModule } from "@decohere/forge";
import { scribe } from "@decohere/scribe";
import { cliLogLevel } from "./log-level.js";
import { RootModule } from "./root.module.js";

const configIndex = process.argv.indexOf("--config-file");
const configFile = configIndex !== -1 ? process.argv[configIndex + 1] : undefined;
const logLevelIndex = process.argv.indexOf("--log-level");
const logLevel = logLevelIndex !== -1 ? process.argv[logLevelIndex + 1] : undefined;
const rootDirIndex = process.argv.indexOf("--root-dir");
const rootDir = rootDirIndex !== -1 ? process.argv[rootDirIndex + 1] : undefined;

scribe.withPinoPretty({
	logLevel: cliLogLevel(logLevel),
	when: "always",
});

const logger = scribe.logger("@decohere/cli");
const app = await RootModule.create([ForgeModule], { configFile, logLevel, rootDir });
let exitCode = 0;
try {
	// Route directly to the forge module — users invoke as `forge build`, not `forge forge build`
	await app.run(["forge", ...process.argv.slice(2)]);
} catch (err) {
	logger.error("Error running forge", err);
	exitCode = 1;
} finally {
	scribe.flush(() => process.exit(exitCode));
}
