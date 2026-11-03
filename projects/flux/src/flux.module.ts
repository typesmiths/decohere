import { createWorkspace } from "@decohere/forge";
import type { WorkspaceFactoryOptions } from "@decohere/devkit/cli";
import { ModuleManifest } from "@decohere/devkit/cli";
import type { ContainerBuilder } from "@decohere/core/composition";
import { DeferredScriptRunner } from "./deferred-script-runner.js";
import { FluxCommand } from "./flux.command.js";
import { HotReloadServer } from "./hot-reload-server.js";
import { RunAction } from "./run.action.js";
import { ServeAction } from "./serve.action.js";

export class FluxModule extends ModuleManifest {
	public readonly id = "flux";
	public readonly command = FluxCommand;
	public readonly actions = {
		serve: ServeAction,
		run: RunAction,
	};

	public registerServices(builder: ContainerBuilder) {
		builder.registerSingleton(HotReloadServer);
		builder.registerSingleton(DeferredScriptRunner);
	}

	public override createWorkspace(options: WorkspaceFactoryOptions) {
		// Same workspace as `flux.run` / `flux.serve` and forge.
		return createWorkspace(options);
	}
}
