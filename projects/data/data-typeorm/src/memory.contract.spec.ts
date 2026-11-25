// What the memory provider expects of TypeOrmMapping: an app whose classes carry TypeORM's
// decorators runs on memory() with that mapping, and nothing mapped a second time.
import "reflect-metadata";
import { Builder } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { injectable } from "@decohere/crucible/decorators";
import {
	type Children,
	ChildList,
	DEFAULT_DATA_SOURCE,
	type IUnitOfWork,
	injectUnitOfWork,
	Repository,
} from "@decohere/data";
import { memory } from "@decohere/data-memory";
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { describe, expect, it } from "vitest";
import { TypeOrmMapping } from "./type-orm-mapping.provider.js";

@Entity()
class Venue {
	@PrimaryColumn("text")
	public code!: string;
	@Column("text")
	public name!: string;
	@OneToMany(() => Pause, (pause) => pause.venue, { persistence: false })
	public pauses: Children<Pause> = new ChildList();
}

@Entity()
class Pause {
	@PrimaryColumn("uuid")
	public id!: string;
	@Column("text")
	public reason!: string;
	@ManyToOne(() => Venue, { nullable: false, onDelete: "CASCADE" })
	@JoinColumn({ name: "venue_code" })
	public venue!: Venue;
}

@injectable()
class VenueRepository extends Repository<Venue> {
	public constructor(@injectUnitOfWork() unitOfWork: IUnitOfWork) {
		super(unitOfWork, Venue);
	}
}

const venue = (code: string, name: string) => Object.assign(new Venue(), { code, name });
const pause = (id: string, reason: string) => Object.assign(new Pause(), { id, reason });

describe("memory() on TypeOrmMapping", () => {
	it("runs classes TypeORM's decorators map, keys, children and cascades included", async () => {
		await using app = await Builder.create(new ServiceContainerBuilder())
			.use(
				memory({
					entities: new TypeOrmMapping([Venue, Pause]),
					repositories: [VenueRepository],
				}),
			)
			.build();
		const request = async <T>(
			work: (venues: VenueRepository, uow: IUnitOfWork) => Promise<T>,
		) => {
			await using scope = app.services.beginScope("a request");
			return await work(scope.resolve(VenueRepository), scope.resolve(DEFAULT_DATA_SOURCE));
		};

		await request(async (venues, uow) => {
			const north = venue("N1", "North");
			north.pauses.add(pause("00000000-0000-4000-8000-000000000001", "maintenance"));
			venues.add(north);
			await uow.commit();
		});
		const loaded = await request((venues) => venues.findById("N1", ["pauses"]));
		expect(loaded.name).toBe("North");
		expect([...loaded.pauses].map((p) => p.reason)).toEqual(["maintenance"]);

		// A second venue with the same key is refused, as the primary key would be.
		await expect(
			request(async (venues, uow) => {
				venues.add(venue("N1", "North again"));
				await uow.commit();
			}),
		).rejects.toThrow();

		// Removing the venue without loading its pauses: ON DELETE CASCADE removes them.
		await request(async (venues, uow) => {
			venues.remove(await venues.findById("N1"));
			await uow.commit();
		});
		expect(await request((_, uow) => uow.find(Pause))).toEqual([]);
	});
});
