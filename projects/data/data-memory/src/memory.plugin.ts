import { type BuilderPlugin, DependencyUnavailableError } from "@decohere/core/hosting";
import type { Constructable } from "@decohere/core/reflection";
import {
	DataConfigurationError,
	DEFAULT_DATA_SOURCE,
	type EntityMapping,
	type IUnitOfWork,
	type OutboxMapper,
	TrackingUnitOfWork,
} from "@decohere/data";
import type { MemoryEntity } from "./memory-entity.js";
import { MemoryRowStore } from "./memory.row-store.js";
import { MemoryStore } from "./memory.store.js";

export type MemoryModuleConfig = {
	/** The data source's name, as `@injectUnitOfWork(name)` asks for it. Required when there are several. */
	name?: string;
	/**
	 * Each mapped class, `mapEntity(Order, { … })`, or another provider's mapping of them, read when
	 * the app is built: `new TypeOrmMapping([Order, Line])` or `new MikroOrmMapping([…])`.
	 */
	entities: MemoryEntity[] | EntityMapping;
	repositories?: Constructable[];
	/** Writes the events aggregates raise to an outbox entity, in the same commit. */
	outbox?: OutboxMapper;
	/** Runs when the app starts, with a unit of work that is committed when it returns. */
	seed?: (unitOfWork: IUnitOfWork) => Promise<void>;
};

/**
 * Keep the data in the process, with no database: for tests and local runs. Each build of the app
 * gets empty stores of its own. Needs no `database` config.
 */
export function memory(config: MemoryModuleConfig[] | MemoryModuleConfig): BuilderPlugin {
	const modules = Array.isArray(config) ? config : [config];
	if (modules.length > 1 && modules.some((m) => m.name == null)) {
		throw new DataConfigurationError("Name is required if there is more than one datasource");
	}
	return (builder) => {
		const stores = new Map<MemoryModuleConfig, MemoryStore>();
		const storeOf = (module: MemoryModuleConfig) => {
			const store = stores.get(module);
			if (store == null) {
				throw new DependencyUnavailableError(
					`data source "${String(module.name ?? DEFAULT_DATA_SOURCE)}"`,
					"the app isn't built yet",
				);
			}
			return store;
		};
		builder.withServices((containerBuilder) => {
			for (const module of modules) {
				containerBuilder.registerRequestScoped(
					module.name ?? DEFAULT_DATA_SOURCE,
					() =>
						new TrackingUnitOfWork(new MemoryRowStore(storeOf(module)), {
							outbox: module.outbox,
						}),
				);
				for (const repository of module.repositories ?? []) {
					containerBuilder.registerRequestScoped(repository);
				}
			}
		});
		// Another provider's mapping is read asynchronously, so each store is made in a step after the
		// container is built: still part of the build, so a mapping that doesn't fit fails it.
		builder.registerPostBuildStep(async () => {
			for (const module of modules) {
				const { entities } = module;
				const models = Array.isArray(entities) ? entities : await entities.models();
				stores.set(module, new MemoryStore(models));
			}
		});
		if (modules.every((m) => m.seed == null)) {
			return;
		}
		builder.registerStartStep(async () => {
			for (const module of modules) {
				if (module.seed == null) {
					continue;
				}
				await using unitOfWork = new TrackingUnitOfWork(new MemoryRowStore(storeOf(module)), {
					outbox: module.outbox,
				});
				await module.seed(unitOfWork);
				await unitOfWork.commit();
			}
		}, "memory data sources");
	};
}
