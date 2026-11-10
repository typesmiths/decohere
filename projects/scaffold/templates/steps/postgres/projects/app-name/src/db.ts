import { db } from "@decohere/data";
import { createApp } from "./app.js";

// The db commands: pnpm decohere db migrate | status | revert | new <name> [--data] | generate <name>.
// In a packaged app: node es6/src/db.js migrate.
// The app is built, not started: no migration runs on start, and nothing listens.
const app = await createApp();
try {
	await db.run(app, process.argv.slice(2), {
		directory: new URL("./migrations/", import.meta.url),
	});
} finally {
	await app.dispose();
}
