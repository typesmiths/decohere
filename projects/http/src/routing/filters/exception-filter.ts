import type { Constructable } from "@decohere/core/reflection";
import { defineMeta, getMeta } from "@decohere/core/reflection";
import { MetadataKeys } from "../../const.js";
import type { HttpRequest } from "../anvil.types.js";

export type ExceptionResult = {
	status: number;
	body: unknown;
	headers?: Record<string, string>;
};

export type ExceptionContext = {
	request: HttpRequest;
};

export interface ExceptionFilter {
	catch(error: unknown, ctx: ExceptionContext): ExceptionResult | Promise<ExceptionResult>;
}

/** Declare which error types this filter handles. Empty = catch-all. */
export function Catch(...types: Constructable[]) {
	return (target: Constructable) => {
		defineMeta(MetadataKeys.catch, types, target);
	};
}

export function getCatchTypes(filterType: Constructable): Constructable[] {
	return getMeta<Constructable[]>(MetadataKeys.catch, filterType) ?? [];
}
