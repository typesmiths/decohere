import type { DefaultLevels } from "./types.js";

export interface BaseLogger {
	get currentLevel(): string;
	get logLevels(): Record<string, number>;
}

export type LogFn = (msg: string | number | object, ...args: unknown[]) => void;

export type Logger<
	CustomLevels extends string = never,
	CustomOnly extends true | false = undefined,
> = {
	[K in DefaultLevels as CustomOnly extends false ? K : never]: LogFn;
} & {
	[Property in CustomLevels]: LogFn;
} & {
	isLevelEnabled(level: string): boolean;
	/**
	 * A logger with the same name and levels that adds `fields` (a request id, a
	 * job name) to every entry. Children of children merge their fields.
	 */
	child(fields: Record<string, unknown>): Logger<CustomLevels, CustomOnly>;
} & BaseLogger;
