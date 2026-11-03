import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const branch = process.env.GITHUB_REF_NAME ?? "local";
const sha = process.env.GITHUB_SHA ?? "local";
const generatedAt = new Date().toISOString();
const outputDir = process.env.PAGES_OUTPUT_DIR ?? "site";

const smokeDir = path.join(outputDir, "smoke", branch);

await mkdir(smokeDir, { recursive: true });

await writeFile(
	path.join(smokeDir, "index.html"),
	`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ark Pages Smoke</title>
  </head>
  <body>
    <h1>Pages Smoke Test</h1>
    <p>Branch: ${branch}</p>
    <p>Commit: ${sha}</p>
    <p>Generated: ${generatedAt}</p>
  </body>
</html>
`,
);

await writeFile(
	path.join(smokeDir, "meta.json"),
	`${JSON.stringify({ branch, sha, generatedAt, path: `smoke/${branch}/` }, null, 2)}\n`,
);

await writeFile(path.join(outputDir, ".nojekyll"), "");
