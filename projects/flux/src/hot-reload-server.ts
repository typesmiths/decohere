import { EventEmitter } from "node:events";
import type { ResolveFnOutput } from "node:module";
import path from "node:path";
import type { Project, ProjectFileEvent, Workspace } from "@decohere/workspace";
import { io } from "@decohere/core/io";
import { WatchEvents } from "@decohere/devkit/io";
import { debounce } from "@decohere/core/system";
import { type Logger, scribe } from "@decohere/scribe";
import type { Subscription } from "@decohere/core/system";
import { SourceModuleLoader } from "./source-module-loader.js";

const currentFilePath = io.fileUrlToPath(import.meta.url);
const VERSION_URL_PARAM = "version";
/** Default quiet window before a file-change reboot. */
export const DEFAULT_REBOOT_DEBOUNCE_MS = 250;
/** How many triggering paths to print on the info banner before `+N`. */
const MAX_REBOOT_TRIGGER_PATHS = 4;

export function resolveRebootDebounceMs(value: number | undefined): number {
	const delay = value ?? DEFAULT_REBOOT_DEBOUNCE_MS;
	if (!Number.isFinite(delay) || delay < 0) {
		throw new Error(`rebootDebounceMs must be a non-negative number, got ${String(value)}`);
	}
	return delay;
}

function formatTriggerList(triggers: readonly string[]): string | undefined {
	if (triggers.length === 0) return undefined;
	if (triggers.length <= MAX_REBOOT_TRIGGER_PATHS) return triggers.join(", ");
	return `${triggers.slice(0, MAX_REBOOT_TRIGGER_PATHS).join(", ")}, +${triggers.length - MAX_REBOOT_TRIGGER_PATHS}`;
}

const BANNER_RULE = "═".repeat(56);

function wrapFluxBanner(title: string, details: readonly string[]): string {
	const body = details.map((line) => `  ${line}`).join("\n");
	return `\n${BANNER_RULE}\n  ${title}\n${body}\n${BANNER_RULE}\n`;
}

/** Info-level HMR start block — keep `flux reboot` in the text so operators can search the buffer. */
export function formatFluxRebootStart(
	labels: readonly string[],
	triggers: readonly string[] = [],
): string {
	const who = labels.join(", ") || "entry";
	const files = formatTriggerList(triggers);
	const details = files == null ? [who] : [who, files];
	return wrapFluxBanner("FLUX REBOOT", details);
}

/** Info-level HMR finish block. */
export function formatFluxRebootReady(labels: readonly string[], elapsedMs: number): string {
	const who = labels.join(", ") || "entry";
	return wrapFluxBanner("FLUX READY", [who, `${Math.max(0, Math.round(elapsedMs))}ms`]);
}

/** Process-wide: Node's ESM cache is process-global, including across HotReloadServer instances. */
let moduleVersionSeq = 0;

export interface HotReloadServerEvents {
	start: [];
	reboot: [];
}

export interface HotReloadServerOptions {
	/** Build configuration name. */
	buildConfig: string;
	/** Name of the project to serve. Defaults to the first project in the workspace. */
	project?: string;
	/**
	 * Multiple Flux app package names to boot in one process (directory slice).
	 * When set, takes precedence over {@link project}.
	 */
	projects?: readonly string[];
	/**
	 * Pre-built Workspace instance to use instead of running WorkspaceFactory.
	 * Useful in tests to bypass filesystem-based workspace discovery.
	 */
	workspace?: Workspace;
	/**
	 * Quiet window in milliseconds after the last affecting save before a reboot.
	 * Defaults to {@link DEFAULT_REBOOT_DEBOUNCE_MS}. Every reload waits this long, so a larger
	 * window only pays off for saves known to come at a steady pace inside it.
	 */
	rebootDebounceMs?: number;
}

type EntryState = {
	path: string;
	label: string;
	module?: AsyncDisposable;
	/** Last boot threw. Its imports may never have resolved, so no graph edges lead to it. */
	failed?: boolean;
};

export class HotReloadServer extends EventEmitter<HotReloadServerEvents> {
	// ── State ────────────────────────────────────────────────────────────────
	private readonly logger: Logger = scribe.logger(HotReloadServer.name);
	private readonly loader = new SourceModuleLoader();
	private disposed = false;
	/** Absolute entry paths currently served (one or more Flux apps). */
	private entries = new Map<string, EntryState>();
	private pendingEntryReboots = new Set<string>();
	/** Source paths that scheduled the next reboot (cleared when that reboot starts). */
	private pendingTriggers = new Set<string>();
	private watchSubscription?: Subscription;
	private moduleCache = new Map<string, string | null>();
	private dependencies = new Map<string, string[]>();
	private rebootTail: Promise<void> = Promise.resolve();
	private rebootDebounceGen = 0;
	private rebootInFlight = false;
	private rebootFollowUp = false;
	private rebootQueued = false;
	/** Modules whose reverse-graph edges are pruned at reboot, not on schedule. */
	private pendingGraphPrune = new Set<string>();
	private scheduleReboot: () => void = () => {};

	// ── Public API ───────────────────────────────────────────────────────────

	public async start(options: HotReloadServerOptions) {
		this.disposed = false;
		this.dependencies.clear();
		this.moduleCache.clear();
		this.entries.clear();
		this.pendingEntryReboots.clear();
		this.pendingTriggers.clear();
		this.pendingGraphPrune.clear();
		this.rebootTail = Promise.resolve();
		this.rebootInFlight = false;
		this.rebootFollowUp = false;
		this.rebootQueued = false;
		this.bindScheduleReboot(resolveRebootDebounceMs(options.rebootDebounceMs));

		const { buildConfig } = options;

		await this.loader.configure({
			buildConfig,
			workspace: options.workspace,
			versionFileUrl: (fileUrl) => this.getCachedOrNew(fileUrl),
			onResolved: this.onPostResolve,
		});

		const workspace = this.requireWorkspace();
		const selected = this.resolveProjects(buildConfig, options);
		for (const project of selected) {
			const entryPath = path.resolve(project.getSourceEntryPath());
			this.entries.set(entryPath, { path: entryPath, label: project.name });
		}

		this.loader.registerHooks();
		this.invalidateAllSourceFiles();

		await workspace.watch(buildConfig);
		this.watchSubscription = workspace.projectFileChanged$.subscribe(this.onFileChange);

		for (const entry of this.entries.values()) {
			this.logger.trace(`Serving ${entry.path}`);
		}
		await this.bootEntries([...this.entries.keys()]);
		this.emit("start");
	}

	public async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.rebootDebounceGen += 1;
		this.watchSubscription?.unsubscribe();
		await this.rebootTail;
		await this.disposeEntries([...this.entries.keys()]);
		this.loader.dispose();
	}

	public async [Symbol.asyncDispose]() {
		await this.dispose();
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	private async bootEntries(entryPaths: readonly string[]) {
		await Promise.all(entryPaths.map((entryPath) => this.bootEntry(entryPath)));
	}

	private async bootEntry(entryPath: string) {
		const state = this.entries.get(entryPath);
		if (state == null) return;
		try {
			const mod = (await this.loader.importEntry(entryPath)) as {
				default?: AsyncDisposable;
			};
			state.module = mod?.default;
			state.failed = false;
		} catch (error) {
			state.module = undefined;
			state.failed = true;
			this.logger.error(
				"There was an error booting the entry point. Your application may not function as expected",
				error,
			);
		}
	}

	private bindScheduleReboot(delayMs: number) {
		const gen = ++this.rebootDebounceGen;
		this.scheduleReboot = debounce(async () => {
			if (this.disposed || gen !== this.rebootDebounceGen) return;
			this.requestReboot();
		}, delayMs);
	}

	private requestReboot() {
		if (this.disposed) return;
		if (this.rebootInFlight) {
			this.rebootFollowUp = true;
			return;
		}
		if (this.rebootQueued) return;
		this.rebootQueued = true;
		this.rebootTail = this.rebootTail.then(
			() => this.runReboot(),
			() => this.runReboot(),
		);
	}

	private async runReboot() {
		this.rebootQueued = false;
		if (this.disposed) return;
		this.rebootInFlight = true;
		try {
			do {
				this.rebootFollowUp = false;
				if (this.disposed) return;
				const toReboot =
					this.pendingEntryReboots.size > 0
						? [...this.pendingEntryReboots]
						: [...this.entries.keys()];
				this.pendingEntryReboots.clear();
				// Drop reverse edges only when rebooting so later saves in the debounce
				// window can still walk the graph and reset the quiet timer.
				this.prunePendingDependencyEdges();
				const startedAt = Date.now();
				const labels = this.labelsFor(toReboot);
				const triggers = this.takeTriggers();
				this.logger.info(formatFluxRebootStart(labels, triggers));
				await this.disposeEntries(toReboot);
				await this.bootEntries(toReboot);
				this.logger.info(formatFluxRebootReady(labels, Date.now() - startedAt));
				this.emit("reboot");
			} while (this.rebootFollowUp && !this.disposed);
		} finally {
			const needsFollowUp = this.rebootFollowUp && !this.disposed;
			this.rebootFollowUp = false;
			this.rebootInFlight = false;
			if (needsFollowUp) this.requestReboot();
		}
	}

	private async disposeEntries(entryPaths: readonly string[]) {
		await Promise.all(entryPaths.map((entryPath) => this.disposeEntry(entryPath)));
	}

	private async disposeEntry(entryPath?: string) {
		const paths = entryPath != null ? [entryPath] : [...this.entries.keys()];
		for (const p of paths) {
			const state = this.entries.get(p);
			if (state == null) continue;
			const entry = state.module;
			state.module = undefined;
			try {
				await entry?.[Symbol.asyncDispose]();
			} catch (error) {
				this.logger.error("Entry asyncDispose failed", error);
			}
		}
	}

	// ── Setup ────────────────────────────────────────────────────────────────

	private requireWorkspace(): Workspace {
		const workspace = this.loader.getWorkspace();
		if (workspace == null) {
			throw new Error("SourceModuleLoader has no workspace after configure");
		}
		return workspace;
	}

	private resolveProjects(buildConfig: string, options: HotReloadServerOptions): Project[] {
		const projects = this.loader.getWorkspace()?.getProjects(buildConfig) ?? [];
		const names =
			options.projects != null && options.projects.length > 0
				? options.projects
				: options.project != null
					? [options.project]
					: undefined;

		if (names == null) {
			const first = projects.at(0);
			if (first == null) {
				throw new Error(`No projects found for configuration: ${buildConfig}`);
			}
			return [first];
		}

		const selected: Project[] = [];
		for (const name of names) {
			const found = projects.find((p) => p.name === name);
			if (found == null) {
				throw new Error(`Project "${name}" not found in workspace`);
			}
			selected.push(found);
		}
		return selected;
	}

	/**
	 * Post-next dependency tracker: records which source files import which
	 * other source files so that reloadIfAffected can traverse the graph.
	 */
	private onPostResolve = (result: ResolveFnOutput, parentUrl: string) => {
		const { url } = result;
		const parentUrlClean = parentUrl.split("?")[0];

		let filePath: string;
		let parentPath: string;

		try {
			const urlObj = new URL(url);
			urlObj.search = "";
			filePath = io.fileUrlToPath(urlObj.toString());
		} catch {
			return;
		}

		try {
			parentPath = io.fileUrlToPath(parentUrlClean);
		} catch {
			parentPath = "";
		}

		const isSource = this.loader.hasSourceFile(filePath);
		const parentIsSource = this.loader.hasSourceFile(parentPath);

		if (isSource || parentIsSource) {
			this.trackDependency(filePath, parentPath);
		}
	};

	// ── File watching ────────────────────────────────────────────────────────

	private onFileChange = (evt: ProjectFileEvent) => {
		const { file, eventName, project } = evt;
		const fullPath = file.fullPath;

		this.logger.trace(`File ${eventName}: ${fullPath}`);

		if (eventName === WatchEvents.unlink) {
			this.loader.invalidateTranspile(fullPath);
			this.moduleCache.set(fullPath, null);
			return;
		}

		if (eventName === WatchEvents.add) {
			if (project.isSourceFile(file)) {
				this.loader.setSourceFile(fullPath, project);
				this.moduleCache.set(fullPath, null);
				this.reloadIfAffected(fullPath);
				this.retryFailedEntries(fullPath);
			}
			return;
		}

		// change
		if (!project.isSourceFile(file)) return;
		this.loader.invalidateTranspile(fullPath);
		this.reloadIfAffected(fullPath);
		this.retryFailedEntries(fullPath);
	};

	/**
	 * A failed boot (e.g. importing a file that doesn't exist yet) may have recorded no
	 * dependency edges, so the graph can't tell whether this save fixes it. Any source
	 * add or change retries failed entries.
	 */
	private retryFailedEntries(fullPath: string) {
		const failed = [...this.entries.values()].filter((entry) => entry.failed);
		if (failed.length === 0) return;
		for (const entry of failed) {
			// New URL version: Node caches the failed load and would replay the same error.
			this.invalidateModuleCaches(entry.path);
			this.pendingEntryReboots.add(entry.path);
		}
		this.pendingTriggers.add(fullPath);
		this.scheduleReboot();
	}

	private reloadIfAffected(fullPath: string): boolean {
		const deps = this.getDependencyGraph(fullPath);
		const modules = [...new Set([...deps, fullPath])];
		const affectedEntries = [...this.entries.keys()].filter((entryPath) =>
			modules.includes(entryPath),
		);

		if (affectedEntries.length === 0) {
			this.logger.trace(`Change in ${fullPath} does not affect entry — skipping reload`);
			return false;
		}

		this.logger.trace(
			`Change in ${fullPath} affects ${modules.length} module(s) — scheduling reload`,
		);
		this.invalidateModuleCaches(...modules);
		for (const module of modules) {
			this.pendingGraphPrune.add(module);
		}
		for (const entryPath of affectedEntries) {
			this.pendingEntryReboots.add(entryPath);
		}
		this.pendingTriggers.add(fullPath);
		this.scheduleReboot();
		return true;
	}

	// ── Dependency graph ─────────────────────────────────────────────────────

	/**
	 * Every module that imports `moduleId`, directly or transitively. Visits each module
	 * once: import graphs share modules (diamonds) and may legally contain cycles.
	 */
	private getDependencyGraph(moduleId: string): string[] {
		if (this.isSelf(moduleId)) return [];
		const found = new Set<string>();
		const queue = [moduleId];
		for (let next = queue.shift(); next != null; next = queue.shift()) {
			for (const importer of this.dependencies.get(next) ?? []) {
				if (found.has(importer)) continue;
				found.add(importer);
				if (this.loader.hasSourceFile(importer) && !this.isSelf(importer))
					queue.push(importer);
			}
		}
		return [...found];
	}

	private trackDependency(filePath: string, parentPath: string) {
		if (!parentPath) return;
		const deps = this.dependencies.get(filePath) ?? [];
		const updatedDeps = new Set([...deps, parentPath]);
		this.dependencies.set(filePath, [...updatedDeps]);
	}

	// ── Module cache ─────────────────────────────────────────────────────────

	private getCachedOrNew(moduleUrl: string) {
		const filePath = io.fileUrlToPath(moduleUrl);
		const cached = this.moduleCache.get(filePath);
		const versioned = cached ?? this.versionModule(moduleUrl);
		this.moduleCache.set(filePath, versioned);
		return versioned;
	}

	private versionModule(moduleUrl: string) {
		const versionedUrl = new URL(moduleUrl);
		versionedUrl.searchParams.set(VERSION_URL_PARAM, String(++moduleVersionSeq));
		return versionedUrl.toString();
	}

	private invalidateModuleCaches(...modules: string[]) {
		for (const module of modules) {
			this.moduleCache.set(module, null);
			this.loader.invalidateTranspile(module);
		}
	}

	private prunePendingDependencyEdges() {
		const modules = [...this.pendingGraphPrune];
		this.pendingGraphPrune.clear();
		this.pruneDependencyParents(...modules);
	}

	/** Remove these modules as parents so boot can rebuild edges without stale importers. */
	private pruneDependencyParents(...modules: string[]) {
		for (const module of modules) {
			for (const [key, parents] of this.dependencies) {
				const filtered = parents.filter((p) => p !== module);
				if (filtered.length === 0) {
					this.dependencies.delete(key);
				} else {
					this.dependencies.set(key, filtered);
				}
			}
		}
	}

	private invalidateAllSourceFiles() {
		for (const filePath of this.loader.sourceFilePaths()) {
			this.moduleCache.set(filePath, null);
		}
	}

	private isSelf(filePath: string) {
		return currentFilePath === path.resolve(filePath);
	}

	private labelsFor(entryPaths: readonly string[]): string[] {
		return entryPaths.map(
			(entryPath) => this.entries.get(entryPath)?.label ?? path.basename(entryPath),
		);
	}

	private takeTriggers(): string[] {
		const triggers = [...this.pendingTriggers].map((fullPath) => this.formatTrigger(fullPath));
		this.pendingTriggers.clear();
		return triggers;
	}

	private formatTrigger(fullPath: string): string {
		const root = this.loader.getWorkspace()?.rootDir;
		if (root != null) {
			const rel = path.relative(path.resolve(root), fullPath);
			if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
				return rel.replaceAll("\\", "/");
			}
		}
		return path.basename(fullPath);
	}
}
