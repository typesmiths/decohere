import type { WorkspaceChanges } from "../templates/workspace-changes.js";

/** Tells the user what to change by hand, where a file no longer has the shape it was given. */
export function printByHand(changes: WorkspaceChanges): void {
	if (changes.byHand.length === 0) return;
	console.log("\n  These files don't have the shape this command can change safely:");
	for (const { file, lines } of changes.byHand) {
		console.log(`\n    ${file}`);
		for (const line of lines) console.log(`      ${line}`);
	}
	console.log("");
}
