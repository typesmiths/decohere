import { inject } from "@decohere/crucible/decorators";

export const DEFAULT_DATA_SOURCE = Symbol("DEFAULT_DATA_SOURCE");

export function injectUnitOfWork(key?: string) {
	return inject(key ?? DEFAULT_DATA_SOURCE);
}
