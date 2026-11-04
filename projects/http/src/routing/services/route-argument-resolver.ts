import type { Constructable, Type } from "@decohere/core/reflection";
import { isPrimitiveOrDateType } from "@decohere/core/reflection";
import type { IPrincipalProvider } from "../../auth/principal-provider.js";
import type { FieldMeta, HttpRequest, RouteArg } from "../http.types.js";
import type { Pipe, PipeContext } from "../pipes/pipes.js";

export class RouteArgumentResolve {
	public resolveArguments(
		httpRequest: HttpRequest,
		routeArgs: RouteArg[],
		principalProvider?: IPrincipalProvider,
	) {
		const argsValues = [];
		for (const [argIdx, routeArg] of routeArgs.entries()) {
			const val = this.getValue(httpRequest, routeArg, principalProvider);
			argsValues[argIdx] = val;
		}
		return argsValues;
	}

	private getValue(
		httpRequest: HttpRequest,
		routeArg: RouteArg,
		principalProvider?: IPrincipalProvider,
	) {
		switch (routeArg.argumentLocation) {
			case "principal":
				return principalProvider?.currentPrincipal;
			case "signal":
				return httpRequest.signal;
			case "lastEventId":
				return httpRequest.headers["last-event-id"];
		}
		const value = isPrimitiveOrDateType(routeArg.argumentType)
			? this.mapPrimitive(httpRequest, routeArg)
			: this.mapObject(httpRequest, routeArg);
		return value;
	}

	private mapPrimitive(httpRequest: HttpRequest, routeArg: RouteArg) {
		const { argumentLocation, mappingKey, pipes } = routeArg;
		const value = httpRequest[argumentLocation][mappingKey];
		const tranformedValue = this.transform(value, pipes, routeArg.fieldMap);
		return tranformedValue;
	}

	private mapObject(httpRequest: HttpRequest, routeArg: RouteArg) {
		const { argumentType } = routeArg;
		const inst = new argumentType();
		const { fieldMap } = routeArg;

		for (const [fieldKey, meta] of fieldMap.entries()) {
			const { fieldLocation, mappingKey, pipes } = meta;
			const value = httpRequest[fieldLocation][mappingKey];
			const transformedValue = this.transform(value, pipes, fieldMap);
			inst[fieldKey] = transformedValue;
		}

		return inst;
	}

	private transform(
		value: unknown,
		pipes: Constructable<Pipe>[] | undefined,
		fieldMap?: Map<string, FieldMeta>,
	) {
		let transformed = value;
		if (value == null) {
			return value;
		}

		const context = this.pipeContext(fieldMap);
		for (const pipeConstructor of pipes ?? []) {
			const pipe = new pipeConstructor();
			transformed = pipe.transform(transformed, context);
		}
		return transformed;
	}

	private pipeContext(fieldMap?: Map<string, FieldMeta>): PipeContext | undefined {
		if (fieldMap == null || fieldMap.size === 0) {
			return undefined;
		}
		const fieldTypes: Record<string, Type> = {};
		for (const [key, meta] of fieldMap.entries()) {
			if (meta.fieldType != null) {
				fieldTypes[key] = meta.fieldType;
			}
		}
		return Object.keys(fieldTypes).length > 0 ? { fieldTypes } : undefined;
	}
}
