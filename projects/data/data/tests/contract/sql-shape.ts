// What the contract compares between providers: the writes each sends, in order, by table and rows,
// and for updates the columns set; plus reads that lock. An insert's column list isn't compared:
// TypeORM lists every column, writing DEFAULT for those it has no value for. Plain reads aren't
// compared at all: MikroORM may join children into one SELECT where the tracker runs one per
// collection, and reads a new version back after a commit where the tracker already knows it.
// Cases where the number of reads matters count them themselves.

const flat = (sql: string) => sql.trim().replace(/\s+/g, " ").toLowerCase();
const table = (name: string) => name.replace(/"/g, "").split(".").pop();

/** How many rows a WHERE names: the length of an `in (…)` list (of values or key tuples), the number of `or`ed keys, or one. */
function rowsIn(where: string): number {
	const tuples = where.match(/ in \((\(.*\))\)/);
	if (tuples) return tuples[1].split(/\)\s*,\s*\(/).length;
	const list = where.match(/ in \(([^)]*)\)/);
	if (list) return list[1].split(",").length;
	return where.split(" or ").length;
}

function one(sql: string): string {
	const s = flat(sql);
	if (/^(begin|start transaction)\b/.test(s)) return "begin";
	if (s.startsWith("commit")) return "commit";
	if (s.startsWith("rollback")) return "rollback";
	const insert = s.match(/^insert into ([^ (]+) ?\(([^)]*)\) values (.*?)(?: returning .*)?$/);
	if (insert) {
		const rows = insert[3].split(/\)\s*,\s*\(/).length;
		return `insert ${table(insert[1])} ×${rows}`;
	}
	const update = s.match(/^update ([^ ]+) set (.*?) where (.*?)(?: returning .*)?$/);
	if (update) {
		const columns = [...update[2].matchAll(/(?:^|, )"([^"]+)" = /g)].map((m) => m[1]);
		return `update ${table(update[1])} (${columns.sort().join(", ")}) ×${rowsIn(update[3])}`;
	}
	const del = s.match(/^delete from ([^ ]+)(?: as [^ ]+)? where (.*)$/);
	if (del) return `delete ${table(del[1])} ×${rowsIn(del[2])}`;
	if (s.startsWith("select"))
		return s.includes(" for update") ? "select for update" : "select";
	if (s.startsWith("with ")) return "select";
	return s;
}

/** The shapes of the writes and locking reads among the statements. */
export function shapes(statements: string[]): string[] {
	return statements.map(one).filter((shape) => shape !== "select");
}

/** How many plain reads the statements hold. */
export function reads(statements: string[]): number {
	return statements.map(one).filter((shape) => shape === "select").length;
}
