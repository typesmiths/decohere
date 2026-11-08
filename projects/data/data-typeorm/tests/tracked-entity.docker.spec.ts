// A scaffolded app's entity, mapped with TypeORM's decorators, through data's unit of work: a key
// the database generates, a simple-json column, and a find by another field, as UserService does.
import "reflect-metadata";
import { TrackingUnitOfWork } from "@decohere/data";
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TypeOrmRowStore } from "../src/type-orm.row-store.js";
import { type PostgresContainer, startPostgres } from "./postgres-container.js";

@Entity()
class UserEntity {
	@PrimaryGeneratedColumn()
	public id!: number;

	@Column({ unique: true })
	public sub!: string;

	@Column({ type: "varchar", nullable: true })
	public email!: string | null;

	@Column()
	public displayName!: string;

	@Column({ type: "simple-json", default: "[]" })
	public roles!: string[];
}

describe("a decorator-mapped entity through the unit of work", () => {
	let pg: PostgresContainer;
	let dataSource: DataSource;
	const begin = () => new TrackingUnitOfWork(new TypeOrmRowStore(dataSource));

	beforeAll(async () => {
		pg = await startPostgres();
		dataSource = await new DataSource({
			type: "postgres",
			host: pg.host,
			port: pg.port,
			username: "postgres",
			password: "postgres",
			database: "postgres",
			entities: [UserEntity],
			synchronize: true,
		}).initialize();
	});

	afterAll(async () => {
		await dataSource?.destroy();
		await pg?.stop();
	});

	it("inserts with a generated key, finds by another field, and writes only what changed", async () => {
		{
			await using uow = begin();
			const user = new UserEntity();
			user.sub = "auth0|ann";
			user.email = null;
			user.displayName = "auth0|ann";
			user.roles = ["admin"];
			uow.add(user);
			await uow.commit();
			expect(user.id).toBeTypeOf("number");
		}
		{
			await using uow = begin();
			const user = await uow.findOne(UserEntity, { where: { sub: "auth0|ann" } });
			expect(user.roles).toEqual(["admin"]);
			expect(await uow.findById(UserEntity, user.id)).toBe(user);
			user.email = "ann@example.com";
			user.roles.push("ops");
			await uow.commit();
		}
		await using uow = begin();
		const user = await uow.findOne(UserEntity, { where: { sub: "auth0|ann" } });
		expect(user).toMatchObject({
			email: "ann@example.com",
			displayName: "auth0|ann",
			roles: ["admin", "ops"],
		});
	});
});
