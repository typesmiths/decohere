import { DEFAULT_DATA_SOURCE } from "@decohere/data";
import { inject } from "@decohere/crucible/decorators";

/** The MikroORM instance when `mikroOrm()` is used without `name`. */
export const MikroOrmToken = Symbol("MikroORM");

/**
 * Container key for a data source's MikroORM instance. Distinct from the unit of work's key
 * (the data source's name, or {@link DEFAULT_DATA_SOURCE}): the instance lives as long as the
 * app, a unit of work as long as a request.
 */
export function mikroOrmToken(name?: string | symbol): symbol {
	if (name == null || name === DEFAULT_DATA_SOURCE) return MikroOrmToken;
	return Symbol.for(`decohere:mikro-orm:${String(name)}`);
}

/**
 * Inject the MikroORM instance, for work that outlives a request. Pass the same `name` as
 * `mikroOrm({ name })`. Request work should use `injectUnitOfWork`.
 */
export function injectMikroOrm(name?: string | symbol) {
	return inject(mikroOrmToken(name));
}
