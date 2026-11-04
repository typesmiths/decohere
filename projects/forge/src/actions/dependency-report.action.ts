import { injectable } from "@decohere/crucible/decorators";
import type { PackageJson, Project } from "@decohere/workspace";
import { Workspace } from "@decohere/workspace";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { io } from "@decohere/core/io";
import { scribe } from "@decohere/scribe";
import { formatUnknownError } from "../errors.js";
import { DependencyResolver } from "../services/dependency-resolver.service.js";
import type { DependencyWarning, DriftEntry, Package } from "../types/dependency.types.js";

type ReportOptions = {
	configuration: string;
	file?: string;
	failOnDrift?: boolean;
};

type ReportEntry = {
	projectName: string;
	dependencies: string[];
	devDependencies: string[];
};

type DriftReport = Record<string, DriftEntry>;

type ProjectReport = {
	projectName: string;
	entry: ReportEntry;
	drift: DriftEntry | null;
	warnings: DependencyWarning[];
};

@injectable()
export class ReportDependencies implements Action<ReportOptions> {
	#logger = scribe.logger(ReportDependencies.name);

	public constructor(
		private readonly workspace: Workspace,
		private readonly resolver: DependencyResolver,
	) {}

	public async run(options: ReportOptions): Promise<ActionResponse<ProjectReport>> {
		const { configuration, file, failOnDrift } = options;
		if (this.workspace.isStandalone) {
			this.#logger.info(
				"Standalone project: its package.json is the root's; nothing to report",
			);
			return ActionResponse.Success(ReportDependencies.name, []);
		}

		try {
			const projectDeps = await this.analyzeWorkspace(this.workspace, configuration);
			this.logReport(projectDeps);

			if (file) {
				await this.writeReportFile(file, projectDeps);
			}

			if (failOnDrift) {
				const driftReport = this.buildDriftReport(projectDeps);
				this.throwOnDrift(driftReport);
			}

			return ActionResponse.Success(ReportDependencies.name, projectDeps);
		} catch (error) {
			const message = formatUnknownError(error);
			return ActionResponse.Error<ProjectReport>(ReportDependencies.name, message);
		}
	}

	private async analyzeWorkspace(
		workspace: Workspace,
		configuration: string,
	): Promise<ProjectReport[]> {
		const projects = workspace.getProjects(configuration);
		const workspacePackages = await this.resolver.getWorkspacePackages(
			this.workspace,
			projects,
		);
		return Promise.all(
			projects.map((project) => this.analyzeProject(project, workspacePackages)),
		);
	}

	private async analyzeProject(
		project: Project,
		workspacePackages: Map<string, Package>,
	): Promise<ProjectReport> {
		const { entry, currentPackage, updatedPackage, warnings } = await this.getDependencies(
			project,
			workspacePackages,
		);
		const drift = this.resolver.computeDrift(currentPackage, updatedPackage);
		return { projectName: project.name, entry, drift, warnings };
	}

	private async getDependencies(
		project: Project,
		workspacePackages: Map<string, Package>,
	): Promise<{
		entry: ReportEntry;
		currentPackage: PackageJson;
		updatedPackage: PackageJson;
		warnings: DependencyWarning[];
	}> {
		const currentPackage = await project.getPackageJson();
		const { updatedPackage, warnings } = await this.resolver.computeProjectDependencies(
			project,
			workspacePackages,
		);

		const entry: ReportEntry = {
			projectName: project.name,
			dependencies: Object.keys(updatedPackage.dependencies ?? {}),
			devDependencies: Object.keys(updatedPackage.devDependencies ?? {}),
		};

		return { entry, currentPackage, updatedPackage, warnings };
	}

	private buildDriftReport(reports: ProjectReport[]): DriftReport {
		return Object.fromEntries(
			reports
				.filter((r): r is ProjectReport & { drift: DriftEntry } => r.drift != null)
				.map((r) => [r.projectName, r.drift]),
		);
	}

	private throwOnDrift(driftReport: DriftReport): void {
		const driftedProjects = Object.keys(driftReport);
		if (driftedProjects.length > 0) {
			for (const [projectName, drift] of Object.entries(driftReport)) {
				this.#logger.warn(`Dependency drift in '${projectName}'`, {
					original: drift.original,
					updated: drift.updated,
				});
			}
			throw new Error(`Dependency drift detected in: ${driftedProjects.join(", ")}`);
		}
	}

	private logReport(reports: ProjectReport[]) {
		for (const { entry, warnings } of reports) {
			this.#logger.info(`${entry.projectName}:`);
			if (entry.dependencies.length) {
				this.#logger.info(`  dependencies: ${entry.dependencies.join(", ")}`);
			}
			if (entry.devDependencies.length) {
				this.#logger.info(`  devDependencies: ${entry.devDependencies.join(", ")}`);
			}
			for (const warning of warnings) {
				this.#logger.warn(`  warning: ${warning.file}:${warning.line}: ${warning.message}`);
			}
		}
	}

	private async writeReportFile(file: string, reports: ProjectReport[]) {
		const lines = reports.flatMap(({ entry, warnings }) => [
			`${entry.projectName}:`,
			...(entry.dependencies.length
				? [`  dependencies: ${entry.dependencies.join(", ")}`]
				: []),
			...(entry.devDependencies.length
				? [`  devDependencies: ${entry.devDependencies.join(", ")}`]
				: []),
			...warnings.map((w) => `  warning: ${w.file}:${w.line}: ${w.message}`),
			"",
		]);
		await io.writeFile(file, lines.join("\n"), { mkdir: true });
		this.#logger.info(`Report written to ${file}`);
	}
}
