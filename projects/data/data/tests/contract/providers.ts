// Opens each provider on the contract suite's schema, with the SQL it sends captured.
import "reflect-metadata";
import { type IUnitOfWork, TrackingUnitOfWork } from "@decohere/data";
import { MikroOrmUnitOfWork } from "@decohere/data-mikro-orm";
import { TypeOrmRowStore } from "@decohere/data-typeorm";
import { MikroORM } from "@mikro-orm/postgresql";
import pg from "pg";
import { DataSource } from "typeorm";
import { mikroOrmEntities } from "./mikro-orm.mapping.js";
import { defineModel, type Model } from "./model.js";
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

export type OpenProvider = {
	name: string;
	/** This provider's own copy of the model classes. */
	model: Model;
	begin(): IUnitOfWork;
	/** Every statement sent since the last call, then cleared. */
	take(): string[];
	close(): Promise<void>;
};

export async function openMikroOrm(c: Connection): Promise<OpenProvider> {
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
		close: () => orm.close(),
	};
}

export async function openTypeOrm(c: Connection): Promise<OpenProvider> {
	const model = defineModel();
	const dataSource = await new DataSource({
		type: "postgres",
		...c,
		username: c.user,
		entities: typeOrmEntities(model),
	}).initialize();
	return {
		name: "TypeORM",
		model,
		begin: () =>
			new TrackingUnitOfWork(new TypeOrmRowStore(dataSource), { outbox: model.toOutbox }),
		take,
		close: () => dataSource.destroy(),
	};
}
