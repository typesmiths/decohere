import path from "node:path";
import { injectable } from "@decohere/crucible/decorators";
import { type Project, Workspace } from "@decohere/workspace";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { type Logger, scribe } from "@decohere/scribe";
import { DeferredScriptRunner } from "./deferred-script-runner.js";
import { HotReloadServer } from "./hot-reload-server.js";
import {
	classifySliceProjects,
	resolveDeferScript,
	type SliceProjectView,
} from "./slice-serve.js";

export type ServeOptions = {
	configuration: string;
	project?: string;
	/** One or more module directory tokens (`funding`, `shell`, `projects/funding`). */
	slices?: string[];
	rebootDebounceMs?: number;
};

@injectable()
export class ServeAction implements Action<ServeOptions> {
	private readonly logger: Logger = scribe.logger(ServeAction.name);

	public constructor(
		private readonly server: HotReloadServer,
		private readonly workspace: Workspace,
		private readonly deferredScripts: DeferredScriptRunner,
	) {}

	public async run(options: ServeOptions): Promise<ActionResponse> {
		const slices = (options.slices ?? []).filter((s) => s !== "");
		if (slices.length > 0 && options.project != null) {
			throw new Error("Use either directory slices or --project, not both");
		}

		if (slices.length > 0) {
			return this.runSlices(options, slices);
		}

		await this.server.start({
			workspace: this.workspace,
			buildConfig: options.configuration,
			project: options.project,
			rebootDebounceMs: options.rebootDebounceMs,
		});
		return ActionResponse.Blocking(ServeAction.name);
	}

	private async runSlices(options: ServeOptions, slices: string[]): Promise<ActionResponse> {
		const views = await this.toSliceViews(options.configuration);
		const classified = classifySliceProjects(views, slices);
		const label = slices.join(" ");

		for (const skipped of classified.skip) {
			this.logger.info(
				`skipped ${skipped.projectDirectory} — library (no Flux entry / scripts)`,
			);
		}

		if (classified.flux.length === 0 && classified.defer.length === 0) {
			throw new Error(
				`No runnable projects in slice(s) "${label}" (need Flux main.ts apps and/or package scripts.dev/serve)`,
			);
		}

		const workspaceRoot = path.resolve(this.workspace.rootDir ?? process.cwd());

		for (const deferred of classified.defer) {
			const script = resolveDeferScript(deferred.scripts);
			if (script == null) continue;
			const project = this.findProject(options.configuration, deferred.name);
			this.deferredScripts.start({
				label: deferred.projectDirectory,
				cwd: project.projectRoot,
				script,
				workspaceRoot,
			});
		}

		if (classified.flux.length > 0) {
			await this.server.start({
				workspace: this.workspace,
				buildConfig: options.configuration,
				projects: classified.flux.map((p) => p.name),
				rebootDebounceMs: options.rebootDebounceMs,
			});
		}

		return ActionResponse.Blocking(ServeAction.name);
	}

	private async toSliceViews(configuration: string): Promise<SliceProjectView[]> {
		const projects = this.workspace.getProjects(configuration);
		return Promise.all(projects.map((project) => this.toSliceView(project)));
	}

	private async toSliceView(project: Project): Promise<SliceProjectView> {
		const pkg = await project.getPackageJson();
		return {
			name: project.name,
			projectDirectory: project.projectDirectory.replaceAll("\\", "/"),
			main: pkg.main ?? "src/index.ts",
			scripts: pkg.scripts ?? {},
		};
	}

	private findProject(configuration: string, name: string): Project {
		const found = this.workspace.getProjects(configuration).find((p) => p.name === name);
		if (found == null) {
			throw new Error(`Project "${name}" not found in workspace`);
		}
		return found;
	}
}
