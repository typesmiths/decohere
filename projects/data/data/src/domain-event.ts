/** Something that happened in the domain, written to the outbox in the same commit as the change that raised it. */
export type DomainEvent = { type: string; payload: unknown };

/** An aggregate that raises events. The unit of work pulls them on commit. */
export interface RaisesEvents {
	pullEvents(): DomainEvent[];
}

/** Turns an event into an entity for the outbox table, which the unit of work adds before it writes. */
export type OutboxMapper = (event: DomainEvent) => object;

function raisesEvents(entity: object): entity is RaisesEvents {
	return typeof (entity as Partial<RaisesEvents>).pullEvents === "function";
}

/** The outbox entities for every event the given entities raised since they were last asked. */
function collect(entities: Iterable<object>, toOutbox: OutboxMapper): object[] {
	const rows: object[] = [];
	for (const entity of entities) {
		if (raisesEvents(entity))
			for (const event of entity.pullEvents()) rows.push(toOutbox(event));
	}
	return rows;
}

export const domainEvents = { collect, raisesEvents };
