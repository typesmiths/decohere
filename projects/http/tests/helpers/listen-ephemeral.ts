import type { App } from "@decohere/core/hosting";
import { startTestApp } from "../../src/testing/index.js";

/**
 * Start `app` on a free loopback port and return its origin. Only a shorter name for
 * `startTestApp`, which owns this, kept for the suites that still call it: new tests use
 * `startTestApp` from `@decohere/http/testing`, and this goes once nothing calls it.
 */
export async function listenEphemeral(app: App): Promise<string> {
	return (await startTestApp(app)).baseUrl;
}
