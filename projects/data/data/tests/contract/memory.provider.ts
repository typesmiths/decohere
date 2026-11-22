// Opens the memory provider on the contract's model, with a fresh store, counting its reads.
import { type Row, type RowQuery, TrackingUnitOfWork, type EntityClass } from "@decohere/data";
import { MemoryRowStore, MemoryStore } from "@decohere/data-memory";
import { memoryEntities } from "./memory.mapping.js";
import { defineModel } from "./model.js";
import type { OpenProvider } from "./providers.js";

export function openMemory(): OpenProvider {
	const model = defineModel();
	const store = new MemoryStore(memoryEntities(model));
	let reads = 0;
	class CountingRowStore extends MemoryRowStore {
		public override select(type: EntityClass, query: RowQuery): Promise<Row[]> {
			if (query.lock == null) reads++;
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
