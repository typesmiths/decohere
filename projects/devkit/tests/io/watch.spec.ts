import path from "node:path";
import { fs, vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watch } from "../../src/io/watch.js";

vi.mock("fs");
vi.mock("node:fs");
vi.mock("fs/promises");
vi.mock("node:fs/promises");

describe("io.watch", () => {
	beforeEach(() => {
		vol.reset();
	});

	afterEach(() => {
		vol.reset();
	});

	it("emits change for nested subdirectory files", async () => {
		const rootPath = "/workspace/project/src";
		const nestedDirectoryPath = path.join(rootPath, "nested", "deeper");
		const nestedFilePath = path.join(nestedDirectoryPath, "index.ts");
		const expectedRelativePath = path.posix.join("nested", "deeper", "index.ts");

		fs.mkdirSync(nestedDirectoryPath, { recursive: true });
		fs.writeFileSync(nestedFilePath, "export const v = 1;", { encoding: "utf8" });

		await new Promise<void>((resolve, reject) => {
			const watcher = watch(rootPath);

			watcher.on("change", (file) => {
				if (file.relativePath !== expectedRelativePath) {
					return;
				}

				expect(file.fullPath).toBe(nestedFilePath);
				watcher.close();
				resolve();
			});

			setTimeout(() => {
				fs.writeFileSync(nestedFilePath, "export const v = 2;", { encoding: "utf8" });
			}, 30);

			setTimeout(() => {
				watcher.close();
				reject(new Error("expected change event was not emitted for nested file"));
			}, 800);
		});
	});

	it("does not emit initial add events when ignoreInitial is true", async () => {
		const rootPath = "/workspace/project/src";
		const existingFilePath = path.join(rootPath, "index.ts");

		fs.mkdirSync(rootPath, { recursive: true });
		fs.writeFileSync(existingFilePath, "export const v = 1;", { encoding: "utf8" });

		await new Promise<void>((resolve, reject) => {
			const watcher = watch(rootPath, { ignoreInitial: true });

			watcher.on("add", () => {
				watcher.close();
				reject(new Error("unexpected initial add event"));
			});

			setTimeout(() => {
				watcher.close();
				resolve();
			}, 100);
		});
	});

	it("emits add for a new file when ignoreInitial is true", async () => {
		const rootPath = "/workspace/project/src";
		const addedFilePath = path.join(rootPath, "new-file.ts");

		fs.mkdirSync(rootPath, { recursive: true });
		fs.writeFileSync(path.join(rootPath, "existing.ts"), "export const x = 1;", {
			encoding: "utf8",
		});

		await new Promise<void>((resolve, reject) => {
			const watcher = watch(rootPath, { ignoreInitial: true });

			watcher.on("add", (file) => {
				if (file.relativePath !== "new-file.ts") {
					return;
				}

				expect(file.fullPath).toBe(addedFilePath);
				watcher.close();
				resolve();
			});

			watcher.ready.then(() => {
				fs.writeFileSync(addedFilePath, "export const y = 2;", { encoding: "utf8" });
			});

			setTimeout(() => {
				watcher.close();
				reject(new Error("expected add event was not emitted for new file"));
			}, 800);
		});
	});

	it("emits unlink when a watched file is deleted", async () => {
		const rootPath = "/workspace/project/src";
		const removedFilePath = path.join(rootPath, "index.ts");

		fs.mkdirSync(rootPath, { recursive: true });
		fs.writeFileSync(removedFilePath, "export const v = 1;", { encoding: "utf8" });

		await new Promise<void>((resolve, reject) => {
			const watcher = watch(rootPath, { ignoreInitial: true });

			watcher.on("unlink", (file) => {
				if (file.relativePath !== "index.ts") {
					return;
				}

				expect(file.fullPath).toBe(removedFilePath);
				watcher.close();
				resolve();
			});

			watcher.ready.then(() => {
				fs.unlinkSync(removedFilePath);
			});

			setTimeout(() => {
				watcher.close();
				reject(new Error("expected unlink event was not emitted for removed file"));
			}, 800);
		});
	});

	it("applies include patterns to emitted events", async () => {
		const rootPath = "/workspace/project/src";
		const ignoredFilePath = path.join(rootPath, "ignored.js");
		const includedFilePath = path.join(rootPath, "included.ts");

		fs.mkdirSync(rootPath, { recursive: true });

		await new Promise<void>((resolve, reject) => {
			const watcher = watch(rootPath, { ignoreInitial: true, include: ["**/*.ts"] });

			watcher.on("add", (file) => {
				if (file.relativePath === "ignored.js") {
					watcher.close();
					reject(new Error("include filter emitted ignored.js unexpectedly"));
					return;
				}

				if (file.relativePath !== "included.ts") {
					return;
				}

				expect(file.fullPath).toBe(includedFilePath);
				watcher.close();
				resolve();
			});

			watcher.ready.then(() => {
				fs.writeFileSync(ignoredFilePath, "export const ignored = true;", {
					encoding: "utf8",
				});
				fs.writeFileSync(includedFilePath, "export const included = true;", {
					encoding: "utf8",
				});
			});

			setTimeout(() => {
				watcher.close();
				reject(new Error("include filter did not emit included.ts"));
			}, 800);
		});
	});

	it("applies ignore patterns to emitted events", async () => {
		const rootPath = "/workspace/project/src";
		const ignoredFilePath = path.join(rootPath, "index.spec.ts");
		const includedFilePath = path.join(rootPath, "index.ts");

		fs.mkdirSync(rootPath, { recursive: true });

		await new Promise<void>((resolve, reject) => {
			const watcher = watch(rootPath, {
				ignoreInitial: true,
				ignore: ["**/*.spec.ts"],
			});

			watcher.on("add", (file) => {
				if (file.relativePath === "index.spec.ts") {
					watcher.close();
					reject(new Error("ignore filter emitted index.spec.ts unexpectedly"));
					return;
				}

				if (file.relativePath !== "index.ts") {
					return;
				}

				expect(file.fullPath).toBe(includedFilePath);
				watcher.close();
				resolve();
			});

			watcher.ready.then(() => {
				fs.writeFileSync(ignoredFilePath, "export const ignored = true;", {
					encoding: "utf8",
				});
				fs.writeFileSync(includedFilePath, "export const included = true;", {
					encoding: "utf8",
				});
			});

			setTimeout(() => {
				watcher.close();
				reject(new Error("ignore filter did not emit index.ts"));
			}, 800);
		});
	});

	it("emits ready after watcher initialization", async () => {
		const rootPath = "/workspace/project/src";
		fs.mkdirSync(rootPath, { recursive: true });
		fs.writeFileSync(path.join(rootPath, "index.ts"), "export const v = 1;", {
			encoding: "utf8",
		});

		await new Promise<void>((resolve, reject) => {
			const watcher = watch(rootPath, { ignoreInitial: true });

			watcher.on("ready", () => {
				watcher.close();
				resolve();
			});

			setTimeout(() => {
				watcher.close();
				reject(new Error("watcher did not emit ready event"));
			}, 200);
		});
	});

	it("resolves watcher.ready after initialization", async () => {
		const rootPath = "/workspace/project/src";
		fs.mkdirSync(rootPath, { recursive: true });
		const watcher = watch(rootPath, { ignoreInitial: true });

		await expect(watcher.ready).resolves.toBeUndefined();
		watcher.close();
	});

	it("emits change only once for a single write", async () => {
		const rootPath = "/workspace/project/src";
		const filePath = path.join(rootPath, "index.ts");

		fs.mkdirSync(rootPath, { recursive: true });
		fs.writeFileSync(filePath, "export const v = 1;", { encoding: "utf8" });

		await new Promise<void>((resolve, reject) => {
			const watcher = watch(rootPath, { ignoreInitial: true });
			let changeCount = 0;

			watcher.on("change", (file) => {
				if (file.relativePath !== "index.ts") {
					return;
				}

				changeCount += 1;
			});

			watcher.ready.then(() => {
				fs.writeFileSync(filePath, "export const v = 2;", { encoding: "utf8" });
			});

			setTimeout(() => {
				watcher.close();
				try {
					expect(changeCount).toBeLessThanOrEqual(1);
					resolve();
				} catch (error) {
					reject(error);
				}
			}, 300);
		});
	});
});
