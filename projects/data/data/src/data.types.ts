import type { Dialect } from "./connection-info.js";

export interface Entity {
	id: number | string;
}

export type LogQuery = {
	dialect: Dialect;
	statement: string;
};
