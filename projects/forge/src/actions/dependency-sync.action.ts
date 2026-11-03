import { injectable } from "@decohere/crucible/decorators";
import type { PackageJson, Project } from "@decohere/workspace";
import { Workspace } from "@decohere/workspace";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { scribe } from "@decohere/scribe";
import { formatUnknownError } from "../errors.js";
import { DependencyResolver } from "../services/dependency-resolver.service.js";
import type { Package, SyncprojectResult } from "../types/dependency.types.js";

export type DependenciesOptions = {
	configuration: string;
	logDiff?: boolean;
};

type SyncComputed =
	| { succeeded: false; syncResult: SyncprojectResult }
	| {
			succeeded: true;
			syncResult: SyncprojectResult;
			project: Project;
			originalPackage: PackageJson;
			updatedPackage: PackageJson;
	  };

@injectable()
export class SyncDependencies implements Action<DependenciesOptions> {
	#logger = scribe.logger(SyncDependencies.name);

	public constructor(
		private readonly workspace: Workspace,
		private readonly resolver: DependencyResolver,
	) {}

	public async run(options: DependenciesOptions): Promise<ActionResponse<SyncprojectResult>> {
		const { configuration, logDiff } = options;

		const projects = this.workspace.getProjects(configuration);
		const workspacePackages = await this.resolver.getWorkspacePackages(
			this.workspace,
			projects,
		);

		const computed = await Promise.all(
			projects.map((project) => this.computeDependenciesFor(project, workspacePackages)),
		);

		const results = computed.map((c) => c.syncResult);
		if (results.some((r) => !r.succeeded)) {
			return ActionResponse.Error(SyncDependencies.name, results);
		}

		const succeeded = computed.filter(
			(c): c is SyncComputed & { succeeded: true } => c.succeeded,
		);

		await Promise.all(succeeded.map((c) => c.project.persistPackageJson(c.updatedPackage)));

		const syncResults = succeeded.map((c) => {
			const drift = this.resolver.computeDrift(c.originalPackage, c.updatedPackage);
			if (drift && logDiff) {
				this.#logger.warn(`Dependency drift synced in '${c.syncResult.projectName}'`, drift);
			}
			return { ...c.syncResult, drift };
		});

		const failedResults = results.filter((r) => !r.succeeded);

		return ActionResponse.Success(SyncDependencies.name, [...syncResults, ...failedResults]);
	}

	private async computeDependenciesFor(
		project: Project,
		workspacePackages: Map<string, Package>,
	): Promise<SyncComputed> {
		try {
			const originalPackage = await project.getPackageJson();
			const { updatedPackage, warnings } = await this.resolver.computeProjectDependencies(
				project,
				workspacePackages,
			);
			for (const warning of warnings) {
				this.#logger.warn(`${warning.file}:${warning.line}: ${warning.message}`);
			}
			return {
				succeeded: true,
				syncResult: { projectName: project.name, succeeded: true },
				project,
				originalPackage,
				updatedPackage,
			};
		} catch (error) {
			const message = formatUnknownError(error);
			return {
				succeeded: false,
				syncResult: {
					projectName: project.name,
					error: `${project.name}: ${message}`,
					succeeded: false,
				},
			};
		}
	}
}
