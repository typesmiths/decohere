import { readFileSync } from "node:fs";
import { WELL_KNOWN_FILES } from "./const.js";
import type { KeyedModel, SourceFile } from "./source-file.js";

/**
 * Model for `.devcontainer/devcontainer.json`.
 *
 * Features call builder methods (`addExtension`, `forwardPort`, etc.) during
 * their configure phase. `MonoRepoScaffold` calls `files()` at render time.
 */

export type PortAttributes = {
	label?: string;
	/** When true, host port must match the container port (no random remap). */
	requireLocalPort?: boolean;
	onAutoForward?: "notify" | "openBrowser" | "openPreview" | "silent" | "ignore";
};

export class DevContainer implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.DEVCONTAINER_JSON;
	private readonly _extensions: string[] = [];
	private readonly _ports: number[] = [];
	private readonly _portAttributes = new Map<number, PortAttributes>();
	private _mounts: string[];
	private _workspaceFolder = "/workspace";
	private _postCreateCommand?: string;
	private _updateContentCommand?: string;
	private _postStartCommand?: string;
	private _initializeCommand?: string;
	private _remoteUser = "node";
	private _useCompose = false;
	private _existing: Record<string, unknown> | undefined;

	/**
	 * Load an existing devcontainer.json so `decohere add api` can merge into it.
	 * Only extensions, forwarded ports and port attributes are merged; everything else is kept.
	 */
	public static fromFile(absolutePath: string): DevContainer {
		const devContainer = new DevContainer();
		try {
			devContainer._existing = JSON.parse(readFileSync(absolutePath, "utf8"));
		} catch (error) {
			throw new Error(
				`Can't update ${absolutePath}: it isn't plain JSON (${(error as Error).message}). Remove any comments or trailing commas and try again.`,
			);
		}
		return devContainer;
	}

	public constructor() {
		this._mounts = [this.bindMount(this._workspaceFolder)];
	}

	/** In-container path Cursor/VS Code opens (Agents window uses the basename). */
	public setWorkspaceFolder(folder: string): this {
		this._workspaceFolder = folder;
		this._mounts = [this.bindMount(folder)];
		return this;
	}

	private bindMount(target: string): string {
		return `source=..,target=${target},type=bind,consistency=cached`;
	}

	public addExtension(...ids: string[]): this {
		this._extensions.push(...ids);
		return this;
	}

	public forwardPort(...ports: number[]): this {
		this._ports.push(...ports);
		return this;
	}

	public setPortAttributes(port: number, attrs: PortAttributes): this {
		this._portAttributes.set(port, attrs);
		return this;
	}

	public setPostCreateCommand(cmd: string): this {
		this._postCreateCommand = cmd;
		return this;
	}

	public setUpdateContentCommand(cmd: string): this {
		this._updateContentCommand = cmd;
		return this;
	}

	public setPostStartCommand(cmd: string): this {
		this._postStartCommand = cmd;
		return this;
	}

	public setInitializeCommand(cmd: string): this {
		this._initializeCommand = cmd;
		return this;
	}

	public setRemoteUser(user: string): this {
		this._remoteUser = user;
		return this;
	}

	public useCompose(): this {
		this._useCompose = true;
		return this;
	}

	public files(): SourceFile[] {
		const config = this._existing ? this.mergeIntoExisting(this._existing) : this.build();
		return [
			{
				filePath: ".devcontainer/devcontainer.json",
				content: JSON.stringify(config, null, 2),
			},
		];
	}

	private mergeIntoExisting(existing: Record<string, unknown>): Record<string, unknown> {
		const config = structuredClone(existing);
		if (this._extensions.length > 0) {
			const customizations = objectAt(config, "customizations");
			const vscode = objectAt(customizations, "vscode");
			vscode.extensions = union(vscode.extensions, this._extensions);
		}
		if (this._ports.length > 0) {
			config.forwardPorts = union(config.forwardPorts, this._ports);
		}
		if (this._portAttributes.size > 0) {
			const attributes = objectAt(config, "portsAttributes");
			for (const [port, attrs] of this._portAttributes) {
				attributes[String(port)] ??= attrs;
			}
		}
		return config;
	}

	private build(): Record<string, unknown> {
		const config: Record<string, unknown> = {};

		if (this._useCompose) {
			config.dockerComposeFile = "docker-compose.yml";
			config.service = "devcontainer";
			config.workspaceFolder = this._workspaceFolder;
		}

		if (this._initializeCommand) {
			config.initializeCommand = this._initializeCommand;
		}

		if (this._mounts) {
			config.mounts = this._mounts;
		}

		if (this._extensions.length > 0) {
			config.customizations = { vscode: { extensions: this._extensions } };
		}

		if (this._ports.length > 0) {
			config.forwardPorts = this._ports;
		}

		if (this._portAttributes.size > 0) {
			const portsAttributes: Record<string, PortAttributes> = {};
			for (const [port, attrs] of this._portAttributes) {
				portsAttributes[String(port)] = attrs;
			}
			config.portsAttributes = portsAttributes;
		}

		if (this._postCreateCommand) {
			config.postCreateCommand = this._postCreateCommand;
		}

		if (this._updateContentCommand) {
			config.updateContentCommand = this._updateContentCommand;
		}

		if (this._postStartCommand) {
			config.postStartCommand = this._postStartCommand;
		}

		if (this._remoteUser) {
			config.remoteUser = this._remoteUser;
		}

		return config;
	}
}

/** The object at `parent[key]`, created when missing. */
function objectAt(parent: Record<string, unknown>, key: string): Record<string, unknown> {
	parent[key] ??= {};
	return parent[key] as Record<string, unknown>;
}

function union<T>(existing: unknown, additions: readonly T[]): T[] {
	const items = Array.isArray(existing) ? [...(existing as T[])] : [];
	for (const item of additions) if (!items.includes(item)) items.push(item);
	return items;
}
