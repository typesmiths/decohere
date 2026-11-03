import type { WorkspaceFactoryOptions } from "@decohere/devkit/cli";
import { ModuleManifest } from "@decohere/devkit/cli";
import type { ContainerBuilder } from "@decohere/core/composition";
import * as Actions from "./actions/index.js";
import * as Commands from "./commands/index.js";
import { createWorkspace } from "./create-workspace.js";
import { DependencyPinner } from "./packaging/dependency-pinner.service.js";
import { ImportGraph } from "./packaging/import-graph.service.js";
import { DependencyResolver } from "./services/dependency-resolver.service.js";
import { FileWriterService } from "./services/file-writer.service.js";
import { SwcTranspiler } from "./services/swc-transpiler.js";
import { TypeEmitter } from "./services/type-emitter.js";
import { TransformerKey } from "./types/transformer.type.js";

export class ForgeModule extends ModuleManifest {
	public readonly id = "forge";
	public readonly command = Commands.ForgeCommand;
	public readonly actions = {
		clean: Actions.Clean,
		copy: Actions.Copy,
		docker: Actions.Docker,
		package: Actions.PackageDeployable,
		build: Actions.Build,
		watch: Actions.Watch,
		publish: Actions.Publish,
		syncDependencies: Actions.SyncDependencies,
		syncLockFile: Actions.SyncLockFile,
		reportDependencies: Actions.ReportDependencies,
		version: Actions.Version,
		tag: Actions.Tag,
		paths: Actions.Paths,
		typecheck: Actions.TypeCheck,
		commitFiles: Actions.CommitFiles,
		link: Actions.Link,
		unlink: Actions.Unlink,
	};
	public readonly commands = {
		build: Commands.BuildCommand,
		publish: Commands.PublishCommand,
		dependencies: Commands.DependencyCommand,
		docker: Commands.DockerCommand,
		package: Commands.PackageCommand,
		version: Commands.VersionCommand,
		tag: Commands.TagCommand,
		paths: Commands.PathsCommand,
		typecheck: Commands.TypeCheckCommand,
		link: Commands.LinkCommand,
		unlink: Commands.UnlinkCommand,
	};

	public registerServices(builder: ContainerBuilder) {
		builder.registerSingleton(TypeEmitter);
		builder.registerSingleton(TransformerKey, SwcTranspiler);
		builder.registerSingleton(TransformerKey, TypeEmitter);
		builder.registerSingleton(DependencyResolver);
		builder.registerSingleton(ImportGraph);
		builder.registerSingleton(DependencyPinner);
		builder.registerSingleton(FileWriterService);
	}

	public override createWorkspace(options: WorkspaceFactoryOptions) {
		return createWorkspace(options);
	}
}
