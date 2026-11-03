import type { ProjectFileEvent, Workspace } from "@decohere/workspace";
import type { Observable } from "rxjs";
import { Subject } from "rxjs";
import type { TransformResponse } from "../types/transform-response.model.js";

/**
 * Runs a transformer's handler for every workspace file change and emits what it built. The
 * handler invalidates the transformer's own caches, rebuilds, and returns the responses (empty
 * for a deletion or when nothing was built).
 */
export class IncrementalWatch {
	readonly #results = new Subject<TransformResponse[]>();

	public get results$(): Observable<TransformResponse[]> {
		return this.#results.asObservable();
	}

	public watch(
		workspace: Workspace,
		handler: (evt: ProjectFileEvent) => Promise<TransformResponse[]>,
	): void {
		workspace.projectFileChanged$.subscribe((evt) => {
			void handler(evt).then((responses) => {
				this.#results.next(responses);
			});
		});
	}
}
