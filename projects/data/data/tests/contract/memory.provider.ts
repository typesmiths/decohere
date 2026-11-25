// Opens the memory provider on the contract's model, with a fresh store, counting its reads. Its
// mapping is its own (`mapEntity`), or the one TypeORM's or MikroORM's mapping of the model gives,
// so a class an ORM maps runs on memory with no second mapping.
import {
	type EntityClass,
	type EntityModel,
	type Row,
	type RowQuery,
	TrackingUnitOfWork,
} from "@decohere/data";
import { MemoryRowStore, MemoryStore } from "@decohere/data-memory";
import { MikroOrmMapping } from "@decohere/data-mikro-orm";
import { TypeOrmMapping } from "@decohere/data-typeorm";
import { memoryEntities } from "./memory.mapping.js";
import { mikroOrmEntities } from "./mikro-orm.mapping.js";
import { defineModel, type Model } from "./model.js";
import type { OpenProvider } from "./providers.js";
import { typeOrmEntities } from "./typeorm.mapping.js";

/** Where the memory provider's mapping of the model comes from. */
export const MEMORY_MAPPINGS: Record<string, (model: Model) => Promise<EntityModel[]>> = {
	"its own": async (model) => memoryEntities(model),
	"TypeORM's": (model) => new TypeOrmMapping(typeOrmEntities(model)).models(),
	"MikroORM's": (model) => new MikroOrmMapping(mikroOrmEntities(model)).models(),
};

export async function openMemory(mapping = MEMORY_MAPPINGS["its own"]): Promise<OpenProvider> {
	const model = defineModel();
	const store = new MemoryStore(await mapping(model));
	let reads = 0;
	class CountingRowStore extends MemoryRowStore {
		public override select(type: EntityClass, query: RowQuery): Promise<Row[]> {
			if (query.lock == null) {
				reads++;
			}
			return super.select(type, query);
		}
	}
	return {
		name: "memory",
		model,
		begin: () =>
			new TrackingUnitOfWork(new CountingRowStore(store), { outbox: model.toOutbox }),
		reads: () => {
			const count = reads;
			reads = 0;
			return count;
		},
		close: async () => {},
	};
}
