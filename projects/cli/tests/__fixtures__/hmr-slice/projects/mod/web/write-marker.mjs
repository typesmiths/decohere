import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

writeFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "deferred.marker"),
	String(process.pid),
);
setInterval(() => {}, 60_000);
