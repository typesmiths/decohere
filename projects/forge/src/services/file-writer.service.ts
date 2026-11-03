import fs from "node:fs/promises";
import { injectable } from "@decohere/crucible/decorators";
import type { Project } from "@decohere/workspace";
import { Trace } from "@decohere/devkit/diagnostics";
import { io } from "@decohere/core/io";
import "../extensions/project.extensions.js";
import type { BuildTarget } from "../types/build-target.type.js";
import type { TransformResponse } from "../types/transform-response.model.js";

const DEFAULT_WRITE_CONCURRENCY = 16;

@Trace
@injectable()
export class FileWriterService {
	#artifactByPath = new Map<string, string>();
	#warmupSignature = "";
	#warmupPromise: Promise<void> | undefined;
	#pendingWrites: TransformResponse[] = [];
	#activeWorkers = 0;
	#drainResolvers: Array<() => void> = [];
	#ensuredDirs = new Set<string>();
	#ensureDirPromises = new Map<string, Promise<void>>();
	#workerError: unknown;

	public async warmup(projects: Project[]): Promise<void> {
		const outputDirs = this.getOutputDirs(projects);
		const signature = outputDirs.join("|");
		if (signature === this.#warmupSignature && this.#warmupPromise != null) {
			return this.#warmupPromise;
		}

		this.#warmupSignature = signature;
		this.#ensuredDirs.clear();
		this.#ensureDirPromises.clear();
		this.#workerError = undefined;
		this.#warmupPromise = this.loadExistingArtifacts(outputDirs);
		return this.#warmupPromise;
	}

	public enqueueOutput(response: TransformResponse): void {
		if (this.#workerError != null) {
			return;
		}
		if (response.outcome !== "success" || response.outputPath == null) {
			return;
		}
		this.#pendingWrites.push(response);
		this.startWorkers();
	}

	public enqueueOutputs(responses: TransformResponse[]): void {
		for (const response of responses) {
			this.enqueueOutput(response);
		}
	}

	public async flush(): Promise<void> {
		if (this.#warmupPromise != null) {
			await this.#warmupPromise;
		}
		if (this.#pendingWrites.length === 0 && this.#activeWorkers === 0) {
			return;
		}
		await new Promise<void>((resolve) => {
			this.#drainResolvers.push(resolve);
		});
		if (this.#workerError != null) {
			throw this.#workerError;
		}
	}

	private getOutputDirs(projects: Project[]): string[] {
		const dirs = new Set<string>();
		for (const project of projects) {
			for (const target of project.getForgeConfiguration().targets) {
				dirs.add(project.getOutDir(target as BuildTarget));
			}
		}
		return [...dirs].sort();
	}

	private async loadExistingArtifacts(outputDirs: string[]): Promise<void> {
		this.#artifactByPath.clear();

		const files: string[] = [];
		for (const dir of outputDirs) {
			files.push(...(await this.collectFiles(dir)));
		}

		await this.withConcurrency(files, this.getWriteConcurrency(), async (filePath) => {
			const content = await fs.readFile(filePath, "utf8");
			this.#artifactByPath.set(filePath, content);
		});
	}

	private async collectFiles(rootDir: string): Promise<string[]> {
		try {
			const entries = await fs.readdir(rootDir, { withFileTypes: true });
			const files: string[] = [];
			for (const entry of entries) {
				const fullPath = `${rootDir}/${entry.name}`;
				if (entry.isDirectory()) {
					files.push(...(await this.collectFiles(fullPath)));
				} else if (entry.isFile()) {
					files.push(fullPath);
				}
			}
			return files;
		} catch {
			return [];
		}
	}

	private getWriteConcurrency(): number {
		const requested = Number(process.env.FORGE_WRITE_CONCURRENCY);
		if (Number.isFinite(requested) && requested > 0) {
			return Math.floor(requested);
		}
		return DEFAULT_WRITE_CONCURRENCY;
	}

	private startWorkers(): void {
		if (this.#workerError != null) {
			return;
		}
		const maxWorkers = this.getWriteConcurrency();
		while (this.#activeWorkers < maxWorkers && this.#pendingWrites.length > 0) {
			this.#activeWorkers += 1;
			void this.runWorker().finally(() => {
				this.#activeWorkers -= 1;
				if (this.#pendingWrites.length > 0) {
					this.startWorkers();
				} else if (this.#activeWorkers === 0) {
					this.resolveDrain();
				}
			});
		}
	}

	private async runWorker(): Promise<void> {
		while (true) {
			const response = this.#pendingWrites.shift();
			if (response == null) {
				return;
			}

			try {
				if (this.#warmupPromise != null) {
					await this.#warmupPromise;
				}

				const outputPath = response.outputPath;
				if (outputPath == null) {
					continue;
				}

				const outputDir = response.outputDir;
				if (outputDir != null) {
					await this.ensureDirectory(outputDir);
				}

				const existing = this.#artifactByPath.get(outputPath);
				if (existing === response.code) {
					continue;
				}

				await io.writeFile(outputPath, response.code);
				this.#artifactByPath.set(outputPath, response.code);
			} catch (error) {
				this.#workerError = error;
				this.#pendingWrites = [];
				return;
			}
		}
	}

	private ensureDirectory(dir: string): Promise<void> {
		if (this.#ensuredDirs.has(dir)) {
			return Promise.resolve();
		}
		const existing = this.#ensureDirPromises.get(dir);
		if (existing != null) {
			return existing;
		}
		const mkdirPromise = fs.mkdir(dir, { recursive: true }).then(() => {
			this.#ensuredDirs.add(dir);
			this.#ensureDirPromises.delete(dir);
		});
		this.#ensureDirPromises.set(dir, mkdirPromise);
		return mkdirPromise;
	}

	private resolveDrain(): void {
		if (this.#pendingWrites.length > 0 || this.#activeWorkers > 0) {
			return;
		}
		for (const resolve of this.#drainResolvers) {
			resolve();
		}
		this.#drainResolvers = [];
	}

	private async withConcurrency<T>(
		items: T[],
		concurrency: number,
		worker: (item: T) => Promise<void>,
	): Promise<void> {
		let cursor = 0;
		const workerCount = Math.min(concurrency, items.length);
		const workers = Array.from({ length: workerCount }, () =>
			(async () => {
				while (true) {
					const index = cursor;
					cursor += 1;
					if (index >= items.length) {
						return;
					}
					await worker(items[index]);
				}
			})(),
		);
		await Promise.all(workers);
	}
}
