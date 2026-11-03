import type { ContainerBuilder } from "@decohere/crucible";
import type { Constructable } from "@decohere/core/reflection";

export type ModuleDefinition = {
	name: string;
	entities?: Constructable[];
	repositories?: Constructable[];
	registerServices?(containerBuilder: ContainerBuilder): void;
};

export abstract class Module {
	public abstract name: string;
	public constructor(data: Partial<Module>) {
		Object.assign(this, data);
	}
	public readonly entities?: readonly Constructable[];
	public readonly repositories?: readonly Constructable[];
	public abstract registerServices?(containerBuilder: ContainerBuilder): void;
}
