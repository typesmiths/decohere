import { readFileSync } from "node:fs";
import { WELL_KNOWN_FILES } from "./const.js";
import type { KeyedModel, SourceFile } from "./source-file.js";

export type LayerWriter = (dockerfile: DockerfileModel) => void;

export class DockerStep {
	public constructor(
		public readonly key: string,
		public readonly content: string,
		public readonly order = 0,
	) {}

	public static run(key: string, command: string, order = 0) {
		return new DockerStep(key, `RUN ${command}`, order);
	}

	public static raw(key: string, content: string, order = 0) {
		return new DockerStep(key, content, order);
	}

	public static entrypoint(key: string, value: string | readonly string[], order = 0) {
		const content =
			typeof value === "string"
				? `ENTRYPOINT ${value}`
				: `ENTRYPOINT ${JSON.stringify(value)}`;
		return new DockerStep(key, content, order);
	}
}

const StepOrder = {
	base: 1_000,
	features: 5_000,
	user: 9_000,
	entrypoint: 10_000,
} as const;

const VSCODE_BOOTLOADER_FIX_BASH_SNIPPET = `if [[ -n "\${NODE_OPTIONS:-}" && "\${NODE_OPTIONS}" == *"bootloader.js"* ]]; then
    _bootloader_path="$(printf '%s\\n' "$NODE_OPTIONS" | sed -n 's/.*--require[= ]\\([^[:space:]]*bootloader\\.js\\).*/\\1/p')"
    if [[ -n "\${_bootloader_path}" && ! -f "\${_bootloader_path}" ]]; then
        _stable_bootloader="$(find /vscode/vscode-server /home/node/.vscode-server/extensions -name "bootloader.js" -path "*/ms-vscode.js-debug/*" 2>/dev/null | head -1)"
        if [[ -n "\${_stable_bootloader}" ]]; then
            NODE_OPTIONS="\${NODE_OPTIONS//\${_bootloader_path}/\${_stable_bootloader}}"
        else
            NODE_OPTIONS="$(printf '%s\\n' "$NODE_OPTIONS" | sed -E 's#(^| )--require(=| )[[:graph:]]*bootloader\\.js( |$)# #g; s#  +# #g; s#^ ##; s# $##')"
            unset VSCODE_INSPECTOR_OPTIONS
        fi
        export NODE_OPTIONS
        if [[ -z "$NODE_OPTIONS" ]]; then
            unset NODE_OPTIONS
        fi
    fi
    unset _bootloader_path _stable_bootloader
fi`;

/** Named volume + paths for interactive bash history in app Dev Containers. */
export const commandHistory = {
	volumeName: "bashhistory",
	dir: "/commandhistory",
	fileName: ".bash_history",
	histFile: "/commandhistory/.bash_history",
} as const;

export function withCommandHistory(options?: {
	historyDir?: string;
	historyFileName?: string;
	username?: string;
	order?: number;
}): LayerWriter {
	const historyDir = options?.historyDir ?? commandHistory.dir;
	const historyFileName = options?.historyFileName ?? commandHistory.fileName;
	const username = options?.username ?? "node";
	const order = options?.order ?? StepOrder.base;
	const historyFile = `${historyDir}/${historyFileName}`;

	return (dockerfile) => {
		dockerfile
			.addStep(
				DockerStep.run(
					"history-dir",
					`mkdir -p ${historyDir} && touch ${historyFile} && chown -R ${username} ${historyDir}`,
					order,
				),
			)
			.addStep(DockerStep.raw("history-env", `ENV HISTFILE=${historyFile}`, order + 1))
			.addStep(
				DockerStep.raw(
					"history-bashrc",
					`RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=${historyFile}" \\\n\t&& echo "$SNIPPET" >> "/home/${username}/.bashrc"`,
					order + 2,
				),
			);
	};
}

export function withNodeUser(options?: {
	username?: string;
	includeUserInstruction?: boolean;
	order?: number;
}): LayerWriter {
	const username = options?.username ?? "node";
	const includeUserInstruction = options?.includeUserInstruction ?? true;
	const order = options?.order ?? StepOrder.features;

	return (dockerfile) => {
		dockerfile.addStep(DockerStep.raw("arg-username", `ARG USERNAME=${username}`, order));

		if (includeUserInstruction) {
			dockerfile.addStep(DockerStep.raw("user", "USER ${USERNAME}", StepOrder.user));
		}
	};
}

export function withPnpm(options?: {
	version?: string;
	usernameExpr?: string;
	order?: number;
}): LayerWriter {
	const version = options?.version ?? "10";
	const usernameExpr = options?.usernameExpr ?? "${USERNAME}";
	const order = options?.order ?? StepOrder.features + 100;

	return (dockerfile) => {
		dockerfile
			.addStep(
				DockerStep.run(
					"pnpm-install",
					`npm install --global npm@latest && npm add --global pnpm@${version}`,
					order,
				),
			)
			.addStep(
				DockerStep.run(
					"pnpm-config",
					`mkdir -p /home/${usernameExpr}/.config/pnpm /home/${usernameExpr}/.pnpm-store && chown -R ${usernameExpr}:${usernameExpr} /home/${usernameExpr}/.config /home/${usernameExpr}/.pnpm-store && printf "store-dir=/home/${usernameExpr}/.pnpm-store\\n" > /home/${usernameExpr}/.config/pnpm/rc`,
					order + 1,
				),
			);
	};
}

/**
 * Client-only (`psql`, etc.). Escalates to root so this also works when layered on
 * a published base image that already switched to `USER node`.
 */
export function withPostgresqlClient(options?: {
	order?: number;
	username?: string;
}): LayerWriter {
	const order = options?.order ?? StepOrder.features + 150;
	const username = options?.username ?? "node";

	return (dockerfile) => {
		dockerfile
			.addStep(DockerStep.raw("postgresql-client-root", "USER root", order))
			.addStep(
				DockerStep.run(
					"postgresql-client",
					"apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*",
					order + 1,
				),
			)
			.addStep(DockerStep.raw("postgresql-client-user", `USER ${username}`, order + 2));
	};
}

/** GitHub CLI — install before USER switches away from root. */
export function withGithubCli(options?: { order?: number }): LayerWriter {
	const order = options?.order ?? StepOrder.features + 140;

	return (dockerfile) => {
		dockerfile.addStep(
			DockerStep.run(
				"github-cli",
				"apt-get update && apt-get install -y --no-install-recommends gh && rm -rf /var/lib/apt/lists/*",
				order,
			),
		);
	};
}

export function withWorkspaceNodeModulesOwnership(options?: {
	workspaceDir?: string;
	usernameExpr?: string;
	order?: number;
	/** Switch to root first: a layer before this one, like withPostgresqlClient, can end on node. */
	asRoot?: boolean;
}): LayerWriter {
	const workspaceDir = options?.workspaceDir ?? "/workspace";
	const usernameExpr = options?.usernameExpr ?? "${USERNAME}";
	const order = options?.order ?? StepOrder.features + 200;

	return (dockerfile) => {
		if (options?.asRoot) {
			dockerfile.addStep(DockerStep.raw("workspace-node-modules-root", "USER root", order));
		}
		dockerfile.addStep(
			DockerStep.raw(
				"workspace-node-modules",
				`RUN mkdir -p ${workspaceDir}/node_modules && chown ${usernameExpr}:${usernameExpr} ${workspaceDir}/node_modules`,
				order + 1,
			),
		);
	};
}

export function withVsCodeJsDebugBootloaderFix(options?: {
	bashrcPath?: string;
	order?: number;
}): LayerWriter {
	const bashrcPath = options?.bashrcPath ?? "/home/${USERNAME}/.bashrc";
	const order = options?.order ?? StepOrder.features + 300;

	return (dockerfile) => {
		dockerfile.addStep(
			DockerStep.raw(
				"vscode-bootloader-fix",
				[
					"# VS Code / Cursor js-debug Auto Attach injects --require …/bootloader.js into",
					"# NODE_OPTIONS. On a fresh Dev Container that path often does not exist yet",
					"# (workspaceStorage file is only created after toggling Auto Attach), which crashes",
					"# every Node command. If the injected path is missing, prefer the stable",
					"# bootloader from the server extension install; otherwise strip the bad require.",
					`RUN cat <<'EOF' >> "${bashrcPath}"`,
					VSCODE_BOOTLOADER_FIX_BASH_SNIPPET,
					"EOF",
				].join("\n"),
				order,
			),
		);
	};
}

export class DockerfileModel implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.DOCKERFILE;
	private readonly _steps = new Map<string, DockerStep>();
	private readonly _layerWriters: LayerWriter[] = [];
	private _fromImage: string;
	private _layerCounter = 0;
	private _existing: { content: string; filePath: string } | undefined;

	public constructor(baseImage: string) {
		this._fromImage = baseImage;
		this.registerBaseLayers();
	}

	/**
	 * Load an existing Dockerfile so `decohere add api` can append feature layers.
	 * The new steps are appended as one block, unless the file already contains it.
	 */
	public static fromFile(absolutePath: string, filePath: string): DockerfileModel {
		const dockerfile = new DockerfileModel("");
		dockerfile._existing = { content: readFileSync(absolutePath, "utf8"), filePath };
		return dockerfile;
	}

	public from(baseImage: string): this {
		this._fromImage = baseImage;
		return this;
	}

	public addLayer(layer: LayerWriter | string, order = StepOrder.features): this {
		if (typeof layer === "string") {
			const idx = ++this._layerCounter;
			const key = `layer-run-${idx}`;
			this._layerWriters.push((dockerfile) => {
				dockerfile.addStep(DockerStep.run(key, layer, order + idx));
			});
			return this;
		}

		this._layerWriters.push(layer);
		return this;
	}

	public addStep(step: DockerStep): this {
		this._steps.set(step.key, step);
		return this;
	}

	public removeStep(key: string): this {
		this._steps.delete(key);
		return this;
	}

	public entrypoint(value: string | readonly string[], order = StepOrder.entrypoint): this {
		this.addStep(DockerStep.entrypoint("entrypoint", value, order));
		return this;
	}

	public addRunStep(cmd: string): this {
		return this.addLayer(cmd);
	}

	public build(): string {
		for (const layerWriter of this._layerWriters) {
			layerWriter(this);
		}

		const sortedSteps = [...this._steps.values()].sort((left, right) => {
			if (left.order !== right.order) {
				return left.order - right.order;
			}
			return left.key.localeCompare(right.key, "en");
		});

		if (this._existing) {
			// All or nothing: skipping one step of a layer (e.g. its `USER root`) would break the rest.
			const { content } = this._existing;
			const block = sortedSteps.map((step) => step.content).join("\n\n");
			if (block === "" || content.includes(block)) return content;
			return `${content.replace(/\n*$/, "\n")}\n${block}\n`;
		}

		const lines = [`FROM ${this._fromImage}`];
		for (const step of sortedSteps) {
			lines.push("", step.content);
		}

		return `${lines.join("\n")}\n`;
	}

	protected registerBaseLayers(): void {
		// Generic base model intentionally has no default layers.
	}

	public files(): SourceFile[] {
		return [
			{
				filePath: this._existing?.filePath ?? "./Dockerfile",
				content: this.build(),
			},
		];
	}
}

/**
 * Shared layers for the published `ghcr.io/typesmiths/decohere/devcontainer` image.
 * Checked in at `projects/devcontainer/Dockerfile` — keep in sync via the unit test.
 */
export class AppDevContainerBaseImage extends DockerfileModel {
	protected override registerBaseLayers(): void {
		super.registerBaseLayers();
		this.addLayer(withCommandHistory())
			.addLayer(withNodeUser())
			.addLayer(withPnpm())
			.addLayer(withGithubCli())
			.addLayer(withWorkspaceNodeModulesOwnership())
			.addLayer(withVsCodeJsDebugBootloaderFix());
	}
}

/** Generic Dev Container image helpers (history + bootloader) without webapi defaults. */
export class DevContainerImageModel extends DockerfileModel {
	protected override registerBaseLayers(): void {
		super.registerBaseLayers();
		this.addLayer(withCommandHistory()).addLayer(withVsCodeJsDebugBootloaderFix());
	}

	public files(): SourceFile[] {
		return [
			{
				filePath: ".devcontainer/Dockerfile",
				content: this.build(),
			},
		];
	}
}
