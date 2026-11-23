/**
 * Finds the CI run that tested a commit and holds its release build, `forge-release-beta-<run id>`,
 * so Publish ships what was tested instead of building again. On `main` that's the merge queue's
 * run: the queue tests the exact commit that lands. A patch branch's is its push run.
 */
import { TestedBuildError } from "./tested-build.error.mjs";

/** How each event's run is named in a message. */
const WHERE = {
	merge_group: "the merge queue",
	push: "a push",
	workflow_dispatch: "a run started by hand",
};

/**
 * @typedef {{ id: number, status: string, conclusion: string | null, html_url: string }} WorkflowRun
 * @typedef {{ runId: number, event: string, url: string }} Found
 */

export class TestedBuild {
	/**
	 * @param {{
	 *   repo: string,
	 *   api: (path: string) => Promise<any>,
	 *   now?: () => number,
	 *   wait?: (ms: number) => Promise<void>,
	 *   log?: (message: string) => void,
	 *   patienceMs?: number,
	 *   pollMs?: number,
	 * }} options
	 */
	constructor(options) {
		this.repo = options.repo;
		this.api = options.api;
		this.now = options.now ?? Date.now;
		this.wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.log = options.log ?? console.error;
		// The queue merges as soon as the `ci` job passes, a moment before its run is marked done.
		this.patienceMs = options.patienceMs ?? 10 * 60_000;
		this.pollMs = options.pollMs ?? 15_000;
	}

	/**
	 * @param {string} sha the commit to ship
	 * @param {string[]} events the CI events whose runs count, in the order to try them
	 * @returns {Promise<Found>}
	 */
	async find(sha, events) {
		/** @type {string[]} */
		const notes = [];
		for (const event of events) {
			const deadline = this.now() + this.patienceMs;
			for (;;) {
				const runs = await this.runs(sha, event);
				const passed = runs.find((run) => run.conclusion === "success");
				if (passed != null) return this.withBuild(sha, passed, event);
				const running = runs.filter((run) => run.status !== "completed");
				if (running.length === 0) {
					notes.push(
						...runs.map((run) => `${run.html_url} (${run.conclusion ?? run.status})`),
					);
					break;
				}
				if (this.now() >= deadline) {
					notes.push(...running.map((run) => `${run.html_url} (still running)`));
					break;
				}
				this.log(`Waiting for ${running.map((run) => run.html_url).join(", ")} to finish`);
				await this.wait(this.pollMs);
			}
		}
		const where = events.map((event) => WHERE[event] ?? event).join(" or ");
		const queue = events.includes("merge_group")
			? " A commit reaches main without one when the merge queue is bypassed (an admin merge or a direct push). Land the change through a pull request and the merge queue."
			: "";
		const runs = notes.length > 0 ? ` Runs for it: ${notes.join(", ")}.` : "";
		throw new TestedBuildError(
			`No CI run in ${where} passed for ${sha}, so there's no tested build to ship. Nothing was published.${queue}${runs}`,
		);
	}

	/**
	 * @private
	 * @returns {Promise<WorkflowRun[]>} newest first
	 */
	async runs(sha, event) {
		const page = await this.api(
			`repos/${this.repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=${event}&per_page=100`,
		);
		return page.workflow_runs ?? [];
	}

	/**
	 * @private
	 * @param {string} sha
	 * @param {WorkflowRun} run
	 * @param {string} event
	 * @returns {Promise<Found>}
	 */
	async withBuild(sha, run, event) {
		const name = `forge-release-beta-${run.id}`;
		const page = await this.api(
			`repos/${this.repo}/actions/runs/${run.id}/artifacts?name=${name}`,
		);
		const build = (page.artifacts ?? []).find((artifact) => artifact.name === name);
		if (build == null || build.expired) {
			const why = build == null ? `has no build ${name}` : `its build ${name} has expired`;
			throw new TestedBuildError(
				`CI run ${run.html_url} passed for ${sha}, but ${why}: CI keeps a build 14 days. Nothing was published.`,
			);
		}
		return { runId: run.id, event, url: run.html_url };
	}
}
