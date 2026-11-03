import { ServiceContainerBuilder } from "@decohere/crucible";
import type {
	ActionClassMap,
	Actions,
	ApplicationModule,
	CommandHandler,
	CommandResponse,
	ModuleConfig,
	ModuleManifest,
	WorkspaceFactoryOptions,
} from "@decohere/devkit/cli";
import type { Constructable } from "@decohere/core/reflection";

/**
 * Wires a ModuleManifest into a fully functional ApplicationModule.
 * Handles DI container setup, action registration/resolution, and
 * forwarding the command response to the caller.
 */
export class ModuleFactory {
	public static create(
		module: ModuleManifest,
		onResponse: (moduleId: string, response: CommandResponse) => void,
		config?: Record<string, unknown>,
	): ApplicationModule {
		const moduleConfig = config?.[module.id] as ModuleConfig | undefined;
		const actions: ActionClassMap = { ...module.actions, ...moduleConfig?.actions };
		const commands = { ...module.commands, ...moduleConfig?.commands };
		const workspaceOptions: WorkspaceFactoryOptions = {
			configFile: config?.configFile as string | undefined,
			rootDir: config?.rootDir as string | undefined,
		};
		let container: ReturnType<ServiceContainerBuilder["build"]> | undefined;

		const handler: CommandHandler = async (_optionVals, program) => {
			const commandOptions = program.optsWithGlobals();
			container = await buildContainer(module, actions, workspaceOptions);
			const resolved = resolveActions(container, actions);
			const response = await program.run(resolved as Actions, commandOptions);
			onResponse(module.id, response);
		};

		const command = new module.command(commands, handler);
		command.name(module.id);

		return {
			id: module.id,
			command,
			dispose: () => container?.[Symbol.dispose](),
			asyncDispose: () => container?.[Symbol.asyncDispose](),
		};
	}
}

async function buildContainer(
	module: ModuleManifest,
	actions: ActionClassMap,
	workspaceOptions?: WorkspaceFactoryOptions,
) {
	const builder = new ServiceContainerBuilder();
	const workspace = await module.createWorkspace(workspaceOptions ?? {});
	if (workspace !== null) {
		builder.registerSingleton(workspace.constructor as Constructable, workspace);
	}

	module.registerServices(builder);
	for (const ActionClass of Object.values(actions)) {
		builder.registerSingleton(ActionClass as Constructable);
	}
	return builder.build();
}

function resolveActions(
	container: ReturnType<ServiceContainerBuilder["build"]>,
	actions: ActionClassMap,
): Record<string, object> {
	return Object.fromEntries(
		Object.entries(actions).map(([key, ActionClass]) => [
			key,
			container.resolve(ActionClass as Constructable),
		]),
	);
}
