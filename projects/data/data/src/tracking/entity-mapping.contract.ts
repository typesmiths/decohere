import type { EntityModel } from "./row-store.js";

/**
 * A provider's mapping of an app's classes, read as {@link EntityModel}s, so another provider can
 * take it rather than the classes being mapped twice: `memory({ entities: new TypeOrmMapping([…]) })`
 * runs on the same mapping as `typeOrm(…)`.
 */
export interface EntityMapping {
	/** Each mapped class's model. Reads the mapping without connecting to a database. */
	models(): Promise<EntityModel[]>;
}
