import { inject, injectable } from "@decohere/crucible/decorators";
import type { Constructable, Field, FunctionType, Type } from "@decohere/core/reflection";
import {
	getArgumentMeta,
	getFields,
	getFunctionArgs,
	getFunctions,
	getMeta,
	isConstructable,
	isPrimitiveOrDateType,
} from "@decohere/core/reflection";
import { HttpOptionsToken, MetadataKeys } from "../../const.js";
import type { HttpOptions } from "../../http/http.options.js";
import type { SseOptions } from "../../sse/sse.types.js";
import type {
	ArgumentMeta,
	ControllerMetadata,
	FieldMeta,
	MappedRoute,
	RouteArg,
	RouteMetadata,
} from "../http.types.js";
import { InjectedParts, RouteConfigurationError, type RequestPart } from "../http.types.js";
import { applyGlobalPrefix, joinRoutePath, normalizePrefix } from "../path.util.js";
import { BooleanPipe, DatePipe, JsonPipe, NumberPipe, type Pipe } from "../pipes/pipes.js";

@injectable()
export class RouteRegistry {
	private readonly routeMap = new Map<string, MappedRoute>();
	private readonly httpOptions?: HttpOptions;

	public constructor(@inject(HttpOptionsToken) httpOptions?: HttpOptions) {
		this.httpOptions = httpOptions;
	}

	public addController(controller: Constructable) {
		const funcs = getFunctions(controller);
		for (const func of funcs) {
			this.addControllerRoute(controller, func);
		}
	}

	public get routes(): MapIterator<MappedRoute> {
		return this.routeMap.values();
	}

	public getRoute(key: string): MappedRoute {
		return this.routeMap.get(key);
	}

	private addControllerRoute(controller: Constructable, prop: PropertyDescriptor) {
		const func = prop.value;
		const handler = func.name;
		const route = getMeta<RouteMetadata>(MetadataKeys.route, func);
		if (route == null) {
			return;
		}

		const globalPrefix = this.takesGlobalPrefix(controller)
			? normalizePrefix(this.httpOptions?.globalPrefix)
			: "";
		const controllerPrefix = this.getControllerPrefix(controller);
		const path = applyGlobalPrefix(globalPrefix, joinRoutePath(controllerPrefix, route.path));
		const { method } = route;
		const key = `${method}|${path}`;
		const existing = this.routeMap.get(key);
		if (existing != null) {
			// Last one used to win silently, leaving the other handler unreachable.
			throw new RouteConfigurationError(
				`Duplicate route ${method.toUpperCase()} ${path}: ${existing.controller.name}.${existing.handler} and ${controller.name}.${handler}`,
			);
		}
		const routeArgs = this.getRouteArguments(controller, func);
		const httpCode = getMeta<number>(MetadataKeys.httpCode, func);
		const headers = getMeta<Record<string, string>>(MetadataKeys.headers, func);
		const sse = getMeta<SseOptions>(MetadataKeys.sse, func);

		this.routeMap.set(key, {
			key,
			controller,
			handler,
			path,
			method,
			routeArgs,
			httpCode,
			headers,
			sse,
		});
	}

	/** `@Controller({ globalPrefix: false })` opts out, unless the app put it back under. */
	private takesGlobalPrefix(controller: Constructable): boolean {
		const meta = getMeta<ControllerMetadata>(MetadataKeys.controller, controller.prototype);
		return (
			meta?.globalPrefix !== false ||
			this.httpOptions?.underGlobalPrefix.has(controller) === true
		);
	}

	private getControllerPrefix(controller: Constructable): string {
		const meta = getMeta<ControllerMetadata>(MetadataKeys.controller, controller.prototype);
		if (meta?.prefix) {
			return normalizePrefix(meta.prefix);
		}
		const controllerName = controller.name.toLowerCase().replace("controller", "");
		return controllerName !== "" ? `/${controllerName}` : "";
	}

	private getRouteArguments(controller: Constructable, handler: FunctionType): RouteArg[] {
		const types = getFunctionArgs(controller.prototype, handler) ?? [];
		const args: RouteArg[] = [];
		for (const [argumentIndex, argumentType] of types.entries()) {
			const argMeta = getArgumentMeta<ArgumentMeta>(
				MetadataKeys.parameter,
				handler,
				argumentIndex,
			);
			if (argMeta == null && !isConstructable(argumentType)) {
				continue;
			}
			args.push(this.getRouteArgument(argumentType, argumentIndex, handler));
		}
		return args;
	}

	private getRouteArgument(
		argumentType: Type,
		argumentIndex: number,
		handler: FunctionType,
	): RouteArg {
		const argMeta = getArgumentMeta<ArgumentMeta>(
			MetadataKeys.parameter,
			handler,
			argumentIndex,
		);

		// A named value typed as a union or interface reaches here as Object, which would build an
		// empty object. Pass the value through as it arrived.
		if (
			argumentType === Object &&
			argMeta?.mappingKey != null &&
			!isInjectedPart(argMeta.argumentLocation)
		) {
			return this.getRouteArgument(String, argumentIndex, handler);
		}

		// @CurrentUser() / interface params are Object (or other non-DTO types) — no field map.
		if (isInjectedPart(argMeta?.argumentLocation) || !isConstructable(argumentType)) {
			return {
				...argMeta,
				pipes: [],
				argumentIndex,
				argumentType: (isConstructable(argumentType) ? argumentType : Object) as Constructable,
				fieldMap: new Map(),
			};
		}

		const pipes = argMeta != null ? this.getDefaultPipes(argumentType) : [];
		const fieldMap = this.getFields(argumentType, argumentIndex, argMeta);
		const routeArg: RouteArg = {
			...argMeta,
			pipes,
			argumentIndex,
			argumentType,
			fieldMap,
		};

		return routeArg;
	}

	private getFields(
		argumentType: Constructable,
		argumentIndex: number,
		argMeta: ArgumentMeta,
	) {
		const inst = new argumentType();
		const fields = getFields(inst);
		const fieldMap =
			getMeta<Map<string, FieldMeta>>(MetadataKeys.fieldMap, argumentType.prototype) ??
			new Map<string, FieldMeta>();

		for (const field of fields) {
			const fieldKey = field.key;
			const fieldMeta = fieldMap.get(field.key);
			if (fieldMeta && fieldMeta.fieldLocation == null && argMeta?.argumentLocation == null) {
				throw new RouteConfigurationError(
					`field ${fieldMeta.fieldKey} must specify a location because location was not specified for the route argument at idx ${argumentIndex}`,
				);
			}
			const enriched = this.enrichField(field, fieldMeta, argMeta);
			fieldMap.set(fieldKey, enriched);
		}

		return fieldMap;
	}

	private enrichField(field: Field, fieldMeta: FieldMeta, argMeta: ArgumentMeta): FieldMeta {
		const fieldLocation = fieldMeta?.fieldLocation ?? argMeta.argumentLocation;
		const pipes = this.getDefaultPipes(fieldMeta?.fieldType);
		return {
			fieldKey: field.key,
			mappingKey: field.key,
			...fieldMeta,
			fieldLocation,
			pipes,
		};
	}

	private getDefaultPipes(argumentType: Type) {
		if (argumentType == null) {
			return [];
		}

		let pipe: Constructable<Pipe>;
		if (!isPrimitiveOrDateType(argumentType)) {
			pipe = JsonPipe;
			return [pipe];
		}
		switch (argumentType.name) {
			case "Number":
				pipe = NumberPipe;
				break;
			case "Boolean":
				pipe = BooleanPipe;
				break;
			case "Date":
				pipe = DatePipe;
				break;
			default:
				return [];
		}

		return [pipe];
	}
}

function isInjectedPart(location: RequestPart | undefined): boolean {
	return location != null && InjectedParts.includes(location);
}
