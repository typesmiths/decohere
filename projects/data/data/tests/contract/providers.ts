// Opens each provider on the contract suite's schema, with the SQL it sends captured. TypeORM is
// opened the way an app opens it, through `typeOrm()`.
import "reflect-metadata";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import { Builder } from "@decohere/core/hosting";
import type { Constructable } from "@decohere/core/reflection";
import { ServiceContainerBuilder } from "@decohere/crucible";
import {
	DatabaseConfig,
	DEFAULT_DATA_SOURCE,
	type IUnitOfWork,
	TrackingUnitOfWork,
} from "@decohere/data";
import { MikroOrmUnitOfWork } from "@decohere/data-mikro-orm";
import { typeOrm, TypeOrmRowStore } from "@decohere/data-typeorm";
import { MikroORM } from "@mikro-orm/postgresql";
import pg from "pg";
import { mikroOrmEntities } from "./mikro-orm.mapping.js";
import { defineModel, type Model } from "./model.js";
import { reads } from "./sql-shape.js";
import { typeOrmEntities } from "./typeorm.mapping.js";

export type Connection = {
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
};

// Both ORMs talk to Postgres through pg, so its client sees every statement either sends,
// transaction control included (MikroORM's onQuery hook doesn't see BEGIN or COMMIT).
const sent: string[] = [];
const query = pg.Client.prototype.query;
pg.Client.prototype.query = function (this: pg.Client, ...args: Parameters<typeof query>) {
	const [first] = args;
	sent.push(typeof first === "string" ? first : (first as { text: string }).text);
	return query.apply(this, args);
} as typeof query;
const take = () => sent.splice(0);
const countReads = () => reads(take());

/** A provider opened for the contract cases, on its own copy of the model. */
export type OpenProvider = {
	name: string;
	/** This provider's own copy of the model classes. */
	model: Model;
	begin(): IUnitOfWork;
	/** How many plain reads it made since the last call. */
	reads(): number;
	close(): Promise<void>;
};

/** A provider on Postgres, whose statements the contract compares. */
export type SqlProvider = OpenProvider & {
	/** Every statement sent since the last call, then cleared. */
	take(): string[];
	/** Runs a statement as a repository in this provider runs its own SQL. `?` marks each parameter. */
	statement(
		uow: IUnitOfWork,
		sql: string,
		params: unknown[],
	): Promise<Record<string, unknown>[]>;
};

/** MikroORM: the entity manager, in the unit of work's transaction. */
async function mikroOrmStatement(uow: IUnitOfWork, sql: string, params: unknown[]) {
	if (!(uow instanceof MikroOrmUnitOfWork)) throw new Error("Not MikroORM's unit of work");
	const em = await uow.transaction();
	return em.execute(sql, params);
}

/** TypeORM: the row store's query runner, in the unit of work's transaction. */
async function typeOrmStatement(uow: IUnitOfWork, sql: string, params: unknown[]) {
	if (!(uow instanceof TrackingUnitOfWork)) throw new Error("Not the tracking unit of work");
	const store = await uow.transaction();
	if (!(store instanceof TypeOrmRowStore)) throw new Error("Not TypeORM's row store");
	let n = 0;
	return store.queryRunner.query(
		sql.replace(/\?/g, () => `$${++n}`),
		params,
	);
}

export async function openMikroOrm(c: Connection): Promise<SqlProvider> {
	const model = defineModel();
	const orm = await MikroORM.init({
		...c,
		dbName: c.database,
		entities: mikroOrmEntities(model),
	});
	return {
		name: "MikroORM",
		model,
		begin: () => new MikroOrmUnitOfWork(orm.em, { outbox: model.toOutbox }),
		take,
		statement: mikroOrmStatement,
		reads: countReads,
		close: () => orm.close(),
	};
}

/** Config with one data source, as an app's config file would give it. */
function databaseConfig(c: Connection): IConfigurationService {
	return {
		dataSources: [],
		async get<T extends object>(type: Constructable<T> | string): Promise<T> {
			const config = new DatabaseConfig();
			if (type === DatabaseConfig) {
				config.dataSources = [
					{
						name: "contract",
						provider: "postgres",
						host: c.host,
						port: c.port,
						database: c.database,
						username: c.user,
						password: c.password,
						synchronize: false,
						seed: false,
						bootstrap: false,
					},
				];
			}
			return config as unknown as T;
		},
	};
}

/** TypeORM as an app uses it: `typeOrm()` given the model's `EntitySchema` mapping. */
export async function openTypeOrm(c: Connection): Promise<SqlProvider> {
	const model = defineModel();
	const app = await Builder.create(new ServiceContainerBuilder())
		.withServices((s) => s.registerSingleton(ConfigurationServiceToken, databaseConfig(c)))
		.use(typeOrm({ entities: typeOrmEntities(model), outbox: model.toOutbox }))
		.build();
	await app.start({ port: 0, shutdownSignals: false, startRetry: false });
	return {
		name: "TypeORM",
		model,
		// One request per unit of work, as an app has.
		begin: () => app.services.beginScope().resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE),
		take,
		statement: typeOrmStatement,
		reads: countReads,
		close: () => app[Symbol.asyncDispose](),
	};
}
