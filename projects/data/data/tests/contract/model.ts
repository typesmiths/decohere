// The contract suite's domain: plain classes, no ORM imports. Each provider maps them in its own file.
import { randomUUID } from "node:crypto";
import { type Children, ChildList, type DomainEvent, type RaisesEvents } from "@decohere/data";

let next = 0;
/** Ids that sort in creation order, so children load in the order a case added them. */
export const id = () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;

/**
 * The classes, made fresh for each provider: MikroORM rewrites the accessors of the classes it
 * maps, so classes shared by two providers in one process would carry MikroORM's into the other.
 */
export function defineModel() {
	class Order implements RaisesEvents {
		public id = id();
		public note: string | null = null;
		public status = "open";
		public placedAt: Date | null = null;
		public version!: number;
		public lines: Children<Line> = new ChildList();
		public approvals: Children<Approval> = new ChildList();
		// Not mapped. Loading skips constructors and initialisers, hence `??=`.
		public events?: DomainEvent[];

		public constructor(public customer: string) {}

		public addLine(sku: string, quantity: number, parts: string[] = []) {
			const line = new Line(sku, quantity);
			for (const name of parts) line.parts.add(new Part(name));
			this.lines.add(line);
			return line;
		}

		public place(at: Date) {
			this.status = "placed";
			this.placedAt = at;
			(this.events ??= []).push({ type: "order.placed", payload: { id: this.id } });
		}

		public pullEvents() {
			const events = this.events ?? [];
			this.events = [];
			return events;
		}
	}

	class Line {
		public id = id();
		public order!: Order;
		public parts: Children<Part> = new ChildList();
		public constructor(
			public sku: string,
			public quantity: number,
		) {}
	}

	/** Keyed by its order and who approved: a composite key that includes a reference. */
	class Approval {
		public order!: Order;
		public constructor(
			public by: string,
			public note: string | null = null,
		) {}
	}

	class Part {
		public id = id();
		public line!: Line;
		public constructor(public name: string) {}
	}

	/** A team and its lead reference each other: a foreign-key cycle. */
	class Team {
		public id = id();
		public lead: Member | null = null;
		public constructor(public name: string) {}
	}

	class Member {
		public id = id();
		public constructor(
			public name: string,
			public team: Team,
		) {}
	}

	/** A key the database generates. */
	class Tag {
		public id!: number;
		public constructor(public label: string) {}
	}

	class OutboxMessage {
		public id = randomUUID();
		public constructor(
			public type: string,
			public payload: unknown,
		) {}
	}

	const toOutbox = (event: DomainEvent) => new OutboxMessage(event.type, event.payload);

	return { Order, Line, Part, Approval, Team, Member, Tag, OutboxMessage, toOutbox };
}

export type Model = ReturnType<typeof defineModel>;
export type Order = InstanceType<Model["Order"]>;

export const SCHEMA = "uow_contract";

/** The tables, written by hand so neither ORM's schema diff is under test here. */
export const DDL = `
drop schema if exists ${SCHEMA} cascade;
create schema ${SCHEMA};
set search_path to ${SCHEMA};
create table orders (id uuid primary key, customer text not null, note text, status text not null, placed_at timestamptz, version int not null default 1);
create table line (id uuid primary key, order_id uuid not null references orders (id), sku text not null, quantity int not null);
create table part (id uuid primary key, line_id uuid not null references line (id), name text not null);
create table approval (order_id uuid not null references orders (id) on delete cascade, by text not null, note text, primary key (order_id, by));
create table team (id uuid primary key, name text not null, lead_id uuid);
create table member (id uuid primary key, name text not null, team_id uuid not null references team (id));
alter table team add foreign key (lead_id) references member (id);
create table tag (id serial primary key, label text not null);
create table outbox (id uuid primary key, type text not null, payload jsonb not null);
`;

export const TABLES = [
	"outbox",
	"tag",
	"part",
	"line",
	"approval",
	"orders",
	"member",
	"team",
];
