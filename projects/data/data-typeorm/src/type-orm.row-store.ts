import {
	comparison,
	type Comparison,
	DataConfigurationError,
	type EntityClass,
	type EntityModel,
	type ReferenceModel,
	type Row,
	type RowQuery,
	type RowStore,
} from "@decohere/data";
import type { DataSource, EntityMetadata, QueryRunner, WhereExpressionBuilder } from "typeorm";

type ColumnMetadata = EntityMetadata["columns"][number];

type Mapped = {
	model: EntityModel;
	meta: EntityMetadata;
	/** The column each field or reference is stored in. */
	columns: Map<string, ColumnMetadata>;
	/** For each reference, the key property of the class it points at. */
	targetKeys: Map<string, string>;
};

const SQL_OPERATORS: Record<string, string> = {
	gt: ">",
	gte: ">=",
	lt: "<",
	lte: "<=",
	ne: "<>",
};

/**
 * The TypeORM provider's share of the unit of work: the mapping, read from TypeORM's metadata,
 * and row operations on one connection. TypeORM builds and sends the SQL; it neither loads
 * relations nor tracks changes here, so child collections are mapped with `persistence: false`.
 */
export class TypeOrmRowStore implements RowStore {
	private readonly runner: QueryRunner;
	private readonly mapped = new Map<EntityClass, Mapped>();

	public constructor(private readonly dataSource: DataSource) {
		this.runner = dataSource.createQueryRunner();
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
		if (!this.runner.isReleased) await this.runner.release();
	}

	public inTransaction() {
		return this.runner.isTransactionActive;
	}

	public async select(type: EntityClass, query: RowQuery): Promise<Row[]> {
		const { model, meta, columns } = this.map(type);
		const props = [...model.fields, ...model.references.map((r) => r.prop)];
		const qb = this.runner.manager.createQueryBuilder().from(meta.target, "e");
		qb.select(
			props.map((prop) => `${this.column("e", columns.get(prop))} AS ${this.escape(prop)}`),
		);
		this.where(qb, columns, query.where ?? {});
		for (const [prop, direction] of Object.entries(query.orderBy ?? {})) {
			qb.addOrderBy(
				this.column("e", this.columnOf(meta, columns, prop)),
				direction === "desc" ? "DESC" : "ASC",
			);
		}
		if (query.limit !== undefined) qb.limit(query.limit);
		if (query.lock === "update") qb.setLock("pessimistic_write");
		const raw = await qb.getRawMany<Row>();
		const driver = this.dataSource.driver;
		return raw.map((r) =>
			Object.fromEntries(
				props.map((prop) => [
					prop,
					r[prop] == null ? null : driver.prepareHydratedValue(r[prop], columns.get(prop)),
				]),
			),
		);
	}

	public async insert(type: EntityClass, rows: Row[]): Promise<Row[]> {
		const { meta } = this.map(type);
		const result = await this.runner.manager
			.createQueryBuilder()
			.insert()
			.into(meta.target)
			.values(rows.map((row) => this.entityShaped(type, row)))
			.execute();
		return result.generatedMaps.map((generated) => this.fromEntityShaped(type, generated));
	}

	public async update(
		type: EntityClass,
		key: Row,
		changes: Row,
		version?: { prop: string; expected: unknown },
	): Promise<number> {
		const { meta, columns } = this.map(type);
		const qb = this.runner.manager
			.createQueryBuilder()
			.update(meta.target)
			.set(this.entityShaped(type, changes));
		this.where(qb, columns, key, "");
		if (version) this.where(qb, columns, { [version.prop]: version.expected }, "");
		const result = await qb.execute();
		return result.affected ?? 0;
	}

	public async delete(type: EntityClass, keys: Row[]) {
		const { meta, columns, model } = this.map(type);
		const qb = this.runner.manager.createQueryBuilder().delete().from(meta.target);
		if (model.key.length === 1) {
			this.where(
				qb,
				columns,
				{ [model.key[0]]: { in: keys.map((k) => k[model.key[0]]) } },
				"",
			);
		} else {
			const parts = keys.map((key, i) =>
				model.key
					.map((prop) => {
						const name = `k${i}_${prop}`;
						qb.setParameter(name, this.persistent(columns.get(prop), key[prop]));
						return `${this.escape(columns.get(prop).databaseName)} = :${name}`;
					})
					.join(" AND "),
			);
			qb.where(parts.map((p) => `(${p})`).join(" OR "));
		}
		await qb.execute();
	}

	// ── Mapping ────────────────────────────────────────────────────────────

	private map(type: EntityClass): Mapped {
		const known = this.mapped.get(type);
		if (known) return known;
		const meta = this.dataSource.getMetadata(type);
		if (typeof meta.target !== "function") {
			throw new DataConfigurationError(`${meta.name} must be mapped to a class to be tracked`);
		}
		const columns = new Map<string, ColumnMetadata>();
		const targetKeys = new Map<string, string>();
		const relations = [...meta.manyToOneRelations, ...meta.ownerOneToOneRelations];
		const references: ReferenceModel[] = relations.map((relation) => {
			if (relation.joinColumns.length !== 1) {
				throw new DataConfigurationError(
					`${meta.name}.${relation.propertyName} references a composite key, which the unit of work can't track`,
				);
			}
			const [join] = relation.joinColumns;
			columns.set(relation.propertyName, join);
			targetKeys.set(relation.propertyName, join.referencedColumn?.propertyName ?? "id");
			return {
				prop: relation.propertyName,
				target: relation.inverseEntityMetadata.target as EntityClass,
				nullable: relation.isNullable,
			};
		});
		const referenceFor = (column: ColumnMetadata) =>
			column.relationMetadata?.propertyName ??
			references.find((r) => columns.get(r.prop)?.databaseName === column.databaseName)?.prop;
		const fields: string[] = [];
		for (const column of meta.columns) {
			if (column.embeddedMetadata) {
				throw new DataConfigurationError(
					`${meta.name}.${column.propertyPath}: embedded columns aren't supported`,
				);
			}
			if (referenceFor(column) || column.isVirtual) continue;
			fields.push(column.propertyName);
			columns.set(column.propertyName, column);
		}
		const model: EntityModel = {
			type,
			name: meta.name,
			key: meta.primaryColumns.map((c) => referenceFor(c) ?? c.propertyName),
			fields,
			references,
			children: meta.oneToManyRelations.map((relation) => {
				if (relation.persistenceEnabled) {
					throw new DataConfigurationError(
						`${meta.name}.${relation.propertyName}: map child collections with persistence: false; the unit of work writes them`,
					);
				}
				return {
					prop: relation.propertyName,
					target: relation.inverseEntityMetadata.target as EntityClass,
					parentRef: relation.inverseRelation?.propertyName,
				};
			}),
			version: meta.versionColumn?.propertyName,
		};
		const mapped = { model, meta, columns, targetKeys };
		this.mapped.set(type, mapped);
		return mapped;
	}

	/** A row as TypeORM's query builders take it: a reference as `{ key: value }`. */
	private entityShaped(type: EntityClass, row: Row): Row {
		const { targetKeys } = this.map(type);
		return Object.fromEntries(
			Object.entries(row).map(([prop, value]) => {
				const key = targetKeys.get(prop);
				return [prop, key && value != null ? { [key]: value } : value];
			}),
		);
	}

	private fromEntityShaped(type: EntityClass, generated: Row): Row {
		const { targetKeys } = this.map(type);
		return Object.fromEntries(
			Object.entries(generated).map(([prop, value]) => {
				const key = targetKeys.get(prop);
				return [
					prop,
					key && value !== null && typeof value === "object" ? (value as Row)[key] : value,
				];
			}),
		);
	}

	private where(
		qb: WhereExpressionBuilder & { setParameter(k: string, v: unknown): unknown },
		columns: Map<string, ColumnMetadata>,
		where: RowQuery["where"],
		alias = "e",
	) {
		for (const [prop, condition] of Object.entries(where ?? {})) {
			const column = columns.get(prop);
			if (!column) throw new DataConfigurationError(`Unknown field "${prop}"`);
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
		if (condition === null) return `${name} IS NULL`;
		const operator = comparison.operatorOf(condition);
		if (!operator) {
			qb.setParameter(param, this.persistent(column, condition));
			return `${name} = :${param}`;
		}
		const [op, operand] = operator;
		if (op === "in") {
			const values = operand as unknown[];
			if (values.length === 0) return "1 = 0";
			qb.setParameter(
				param,
				values.map((v) => this.persistent(column, v)),
			);
			return `${name} IN (:...${param})`;
		}
		if (op === "ne" && operand === null) return `${name} IS NOT NULL`;
		qb.setParameter(param, this.persistent(column, operand));
		return `${name} ${SQL_OPERATORS[op]} :${param}`;
	}

	private persistent(column: ColumnMetadata, value: unknown) {
		return this.dataSource.driver.preparePersistentValue(value, column);
	}

	private columnOf(meta: EntityMetadata, columns: Map<string, ColumnMetadata>, prop: string) {
		const column = columns.get(prop);
		if (!column) throw new DataConfigurationError(`${meta.name} has no field "${prop}"`);
		return column;
	}

	private column(alias: string, column: ColumnMetadata) {
		return `${this.escape(alias)}.${this.escape(column.databaseName)}`;
	}

	private escape(name: string) {
		return this.dataSource.driver.escape(name);
	}
}
