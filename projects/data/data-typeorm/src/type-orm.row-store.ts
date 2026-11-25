import {
	comparison,
	type Comparison,
	DataConfigurationError,
	type EntityClass,
	type TrackingUnitOfWork,
	type EntityModel,
	type Row,
	type RowQuery,
	type RowStore,
} from "@decohere/data";
import type { DataSource, EntityMetadata, QueryRunner, WhereExpressionBuilder } from "typeorm";
import { TypeOrmEntityModel } from "./type-orm-entity.model.js";

type ColumnMetadata = EntityMetadata["columns"][number];

const SQL_OPERATORS: Record<string, string> = {
	gt: ">",
	gte: ">=",
	lt: "<",
	lte: "<=",
	ne: "<>",
};

/**
 * The unit of work `typeOrm()` registers. A provider-side repository injects it as this type to run
 * its own SQL in the unit of work's transaction: `(await unitOfWork.transaction()).queryRunner`.
 */
export type TypeOrmUnitOfWork = TrackingUnitOfWork<TypeOrmRowStore>;

/**
 * The TypeORM provider's share of the unit of work: the mapping, read from TypeORM's metadata,
 * and row operations on one connection. TypeORM builds and sends the SQL; it neither loads
 * relations nor tracks changes here, so child collections are mapped with `persistence: false`.
 */
export class TypeOrmRowStore implements RowStore {
	private readonly runner: QueryRunner;
	private readonly mapped = new Map<EntityClass, TypeOrmEntityModel>();

	public constructor(private readonly dataSource: DataSource) {
		this.runner = dataSource.createQueryRunner();
	}

	/**
	 * The unit of work's own connection. A statement run on it is in the unit of work's transaction
	 * when one is open: get it through {@link TypeOrmUnitOfWork}'s `transaction()`, which opens one.
	 */
	public get queryRunner(): QueryRunner {
		return this.runner;
	}

	public model(type: EntityClass): EntityModel {
		return this.map(type).model;
	}

	public begin() {
		return this.runner.startTransaction();
	}

	public commit() {
		return this.runner.commitTransaction();
	}

	public rollback() {
		return this.runner.rollbackTransaction();
	}

	public async release() {
		if (!this.runner.isReleased) {
			await this.runner.release();
		}
	}

	public inTransaction() {
		return this.runner.isTransactionActive;
	}

	public async select(type: EntityClass, query: RowQuery): Promise<Row[]> {
		const entity = this.map(type);
		const { model, metadata: meta } = entity;
		const fields = model.fields.filter(
			(field) => !model.lazy?.includes(field) || query.load?.includes(field),
		);
		const props = [...fields, ...model.references.map((r) => r.prop)];
		const qb = this.runner.manager.createQueryBuilder().from(meta.target, "e");
		qb.select(
			props.map(
				(prop) => `${this.column("e", entity.columnOf(prop))} AS ${this.escape(prop)}`,
			),
		);
		this.where(qb, entity, query.where ?? {});
		for (const [prop, direction] of Object.entries(query.orderBy ?? {})) {
			qb.addOrderBy(
				this.column("e", this.requiredColumn(entity, prop)),
				direction === "desc" ? "DESC" : "ASC",
			);
		}
		if (query.limit !== undefined) {
			qb.limit(query.limit);
		}
		if (query.lock === "update") {
			qb.setLock("pessimistic_write");
		}
		const raw = await qb.getRawMany<Row>();
		const driver = this.dataSource.driver;
		return raw.map((r) =>
			Object.fromEntries(
				props.map((prop) => [
					prop,
					r[prop] == null ? null : driver.prepareHydratedValue(r[prop], entity.columnOf(prop)),
				]),
			),
		);
	}

	public async insert(type: EntityClass, rows: Row[]): Promise<Row[]> {
		const meta = this.map(type).metadata;
		const result = await this.runner.manager
			.createQueryBuilder()
			.insert()
			.into(meta.target)
			.values(rows.map((row) => this.entityShaped(type, row)))
			.execute();
		return result.generatedMaps.map((generated) => this.fromEntityShaped(type, generated));
	}

	public async insertIfAbsent(type: EntityClass, row: Row): Promise<Row | null> {
		const { metadata: meta, model } = this.map(type);
		// The key says whether a row came back; generated fields are what the entity takes from it.
		const generated = meta.columns.filter(
			(c) => c.isGenerated && model.fields.includes(c.propertyName),
		);
		const returned = [...new Set([...meta.primaryColumns, ...generated])];
		const result = await this.runner.manager
			.createQueryBuilder()
			.insert()
			.into(meta.target)
			.values(this.entityShaped(type, row))
			.orIgnore()
			.returning(returned.map((c) => c.propertyPath))
			.updateEntity(false)
			.execute();
		const [inserted] = result.raw as Row[];
		if (inserted === undefined) {
			return null;
		}
		const driver = this.dataSource.driver;
		return Object.fromEntries(
			generated.map((c) => [
				c.propertyName,
				driver.prepareHydratedValue(inserted[c.databaseName], c),
			]),
		);
	}

	public async update(
		type: EntityClass,
		key: Row,
		changes: Row,
		version?: { prop: string; expected: unknown },
	): Promise<number> {
		const entity = this.map(type);
		const qb = this.runner.manager
			.createQueryBuilder()
			.update(entity.metadata.target)
			.set(this.entityShaped(type, changes));
		this.where(qb, entity, key, "");
		if (version) {
			this.where(qb, entity, { [version.prop]: version.expected }, "");
		}
		const result = await qb.execute();
		return result.affected ?? 0;
	}

	public async delete(type: EntityClass, keys: Row[]) {
		const entity = this.map(type);
		const { model } = entity;
		const qb = this.runner.manager.createQueryBuilder().delete().from(entity.metadata.target);
		if (model.key.length === 1) {
			this.where(qb, entity, { [model.key[0]]: { in: keys.map((k) => k[model.key[0]]) } }, "");
		} else {
			const parts = keys.map((key, i) =>
				model.key
					.map((prop) => {
						const name = `k${i}_${prop}`;
						const column = entity.columnOf(prop);
						qb.setParameter(name, this.persistent(column, key[prop]));
						return `${this.escape(column.databaseName)} = :${name}`;
					})
					.join(" AND "),
			);
			qb.where(parts.map((p) => `(${p})`).join(" OR "));
		}
		await qb.execute();
	}

	// ── Mapping ────────────────────────────────────────────────────────────

	private map(type: EntityClass): TypeOrmEntityModel {
		const known = this.mapped.get(type);
		if (known) {
			return known;
		}
		const mapped = new TypeOrmEntityModel(this.dataSource.getMetadata(type));
		this.mapped.set(type, mapped);
		return mapped;
	}

	/** A row as TypeORM's query builders take it: a reference as `{ key: value }`. */
	private entityShaped(type: EntityClass, row: Row): Row {
		const entity = this.map(type);
		return Object.fromEntries(
			Object.entries(row).map(([prop, value]) => {
				const key = entity.targetKeyOf(prop);
				return [prop, key && value != null ? { [key]: value } : value];
			}),
		);
	}

	private fromEntityShaped(type: EntityClass, generated: Row): Row {
		const entity = this.map(type);
		return Object.fromEntries(
			Object.entries(generated).map(([prop, value]) => {
				const key = entity.targetKeyOf(prop);
				return [
					prop,
					key && value !== null && typeof value === "object" ? (value as Row)[key] : value,
				];
			}),
		);
	}

	private where(
		qb: WhereExpressionBuilder & { setParameter(k: string, v: unknown): unknown },
		entity: TypeOrmEntityModel,
		where: RowQuery["where"],
		alias = "e",
	) {
		for (const [prop, condition] of Object.entries(where ?? {})) {
			const column = entity.columnOf(prop);
			if (!column) {
				throw new DataConfigurationError(`Unknown field "${prop}"`);
			}
			const name = alias ? this.column(alias, column) : this.escape(column.databaseName);
			const param = `p${this.parameter++}`;
			qb.andWhere(this.condition(name, param, column, condition, qb));
		}
	}
	private parameter = 0;

	private condition(
		name: string,
		param: string,
		column: ColumnMetadata,
		condition: Comparison<unknown>,
		qb: { setParameter(k: string, v: unknown): unknown },
	): string {
		if (condition === null) {
			return `${name} IS NULL`;
		}
		const operator = comparison.operatorOf(condition);
		if (!operator) {
			qb.setParameter(param, this.persistent(column, condition));
			return `${name} = :${param}`;
		}
		const [op, operand] = operator;
		if (op === "in") {
			const values = operand as unknown[];
			if (values.length === 0) {
				return "1 = 0";
			}
			qb.setParameter(
				param,
				values.map((v) => this.persistent(column, v)),
			);
			return `${name} IN (:...${param})`;
		}
		if (op === "ne" && operand === null) {
			return `${name} IS NOT NULL`;
		}
		qb.setParameter(param, this.persistent(column, operand));
		return `${name} ${SQL_OPERATORS[op]} :${param}`;
	}

	private persistent(column: ColumnMetadata, value: unknown) {
		return this.dataSource.driver.preparePersistentValue(value, column);
	}

	private requiredColumn(entity: TypeOrmEntityModel, prop: string) {
		const column = entity.columnOf(prop);
		if (!column) {
			throw new DataConfigurationError(`${entity.model.name} has no field "${prop}"`);
		}
		return column;
	}

	private column(alias: string, column: ColumnMetadata) {
		return `${this.escape(alias)}.${this.escape(column.databaseName)}`;
	}

	private escape(name: string) {
		return this.dataSource.driver.escape(name);
	}
}
