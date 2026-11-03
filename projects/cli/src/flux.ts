#!/usr/bin/env node
import "./logger.setup.js";
import { FluxModule } from "@decohere/flux";
import { scribe } from "@decohere/scribe";
import { cliLogLevel } from "./log-level.js";
import { RootModule } from "./root.module.js";

const configIndex = process.argv.indexOf("--config-file");
const configFile = configIndex !== -1 ? process.argv[configIndex + 1] : undefined;
const logLevelIndex = process.argv.indexOf("--log-level");
const logLevel = logLevelIndex !== -1 ? process.argv[logLevelIndex + 1] : undefined;

scribe.withPinoPretty({
	logLevel: cliLogLevel(logLevel),
	when: "always",
});

const logger = scribe.logger("@decohere/cli");
const app = await RootModule.create([FluxModule], { configFile, logLevel });
try {
	// Route directly to the flux module — users invoke as `flux serve`, not `flux flux serve`
	logger.trace("running flux");
	await app.run(["flux", ...process.argv.slice(2)]);
	// Don't force an exit: let the script's pending work (timers, open handles) finish, like
	// `node script.js` does.
	scribe.flush();
} catch (err) {
	logger.error(err);
	scribe.flush(() => process.exit(1));
}
