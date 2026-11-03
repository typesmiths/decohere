import { DEFAULT_DATA_SOURCE } from "@decohere/data";
import { inject } from "@decohere/crucible/decorators";

/** Default TypeORM DataSource when `withTypeOrm` is used without `name`. */
export const TypeOrmDataSourceToken = Symbol("TypeOrmDataSource");

/**
 * Container key for a TypeORM DataSource. Distinct from the unit-of-work key
 * (datasource name / {@link DEFAULT_DATA_SOURCE}) so request-scoped UoW and
 * process-lifetime DataSource can coexist.
 */
export function typeOrmDataSourceToken(name?: string | symbol): symbol {
	if (name == null || name === DEFAULT_DATA_SOURCE) {
		return TypeOrmDataSourceToken;
	}
	return Symbol.for(`decohere:typeorm:datasource:${String(name)}`);
}

/**
 * Inject the TypeORM DataSource for process-lifetime (singleton) work.
 * Pass the same `name` as `withTypeOrm({ name })`. Request-scoped persistence
 * should keep using `injectUnitOfWork`.
 */
export function injectDataSource(name?: string | symbol) {
	return inject(typeOrmDataSourceToken(name));
}
