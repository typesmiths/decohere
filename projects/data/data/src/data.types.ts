import type { Dialect } from "./connection-info.js";

export type LogQuery = {
	dialect: Dialect;
	statement: string;
};
