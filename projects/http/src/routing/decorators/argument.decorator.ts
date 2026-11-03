import type { Constructable } from "@decohere/core/reflection";
import { defineArgumentMeta } from "@decohere/core/reflection";
import { MetadataKeys } from "../../const.js";
import { type ArgumentMeta, type RequestPart, RequestParts } from "../anvil.types.js";
import type { Pipe } from "../pipes/pipes.js";

export type ArgumentOptions = {
	mappingKey?: string;
	argumentLocation?: RequestPart;
	pipes?: Constructable<Pipe>[];
};

export function Query(key: string) {
	return Argument({ mappingKey: key, argumentLocation: RequestParts.query });
}

export function Param(key: string) {
	return Argument({ mappingKey: key, argumentLocation: RequestParts.params });
}

export function Argument(options: ArgumentOptions) {
	return (target: object, functionName: string, argumentIndex: number) => {
		const { mappingKey, argumentLocation, pipes } = options;
		const func = target[functionName];
		const meta: ArgumentMeta = {
			argumentIndex,
			mappingKey,
			argumentLocation,
			pipes,
		};
		defineArgumentMeta<ArgumentMeta>(MetadataKeys.parameter, meta, func, argumentIndex);
	};
}
