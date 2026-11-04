import type { ProjectFileEvent, Workspace } from "@decohere/workspace";
import { Subject } from "@decohere/core/system";
import { describe, expect, it } from "vitest";
import { IncrementalWatch } from "../../src/services/incremental-watch.js";
import type { TransformResponse } from "../../src/types/transform-response.model.js";

describe("IncrementalWatch", () => {
	it("runs the handler for each file change and emits what it built, per instance", async () => {
		const changes = new Subject<ProjectFileEvent>();
		const workspace = { projectFileChanged$: changes } as unknown as Workspace;
		const built = [{ outcome: "success" }] as unknown as TransformResponse[];
		const seen: ProjectFileEvent[] = [];
		const watcher = new IncrementalWatch();
		const other = new IncrementalWatch();
		const emitted: TransformResponse[][] = [];
		const otherEmitted: TransformResponse[][] = [];
		watcher.results$.subscribe((responses) => emitted.push(responses));
		other.results$.subscribe((responses) => otherEmitted.push(responses));

		watcher.watch(workspace, async (evt) => {
			seen.push(evt);
			return built;
		});
		const evt = { eventName: "change" } as unknown as ProjectFileEvent;
		changes.next(evt);
		await Promise.resolve();
		await Promise.resolve();

		expect(seen).toEqual([evt]);
		expect(emitted).toEqual([built]);
		expect(otherEmitted).toEqual([]);
	});
});
