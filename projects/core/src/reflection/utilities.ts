import {
	type Constructable,
	type Field,
	type FunctionType,
	ReflectionMeta,
	type Type,
} from "./types/reflection.types.js";

const Primitives = ["string", "number", "bigint", "boolean", "undefined", "symbol", "null"];

export const isPrimitiveOrDateType = (type: Type) => {
	return Primitives.includes(type.name.toLocaleLowerCase()) || isDateType(type);
};

export const isDateType = (type: Type) => {
	return type?.prototype === Date.prototype;
};

export function isConstructable(
	type: Constructable | object | FunctionType,
): type is Constructable {
	const proto = (type as Constructable)?.prototype;
	const isConstructable = typeof type === "function" && typeof proto === "object";
	return isConstructable;
}
export const isArrayType = (type: Type) => {
	return type?.prototype === Array.prototype;
};
export function getMeta<T>(key: string, target: object, propertyKey?: string) {
	const meta = Reflect.getMetadata(key, target, propertyKey) as T;
	return meta;
}
export function getFunctions(object: Constructable) {
	const functions = Object.entries(Object.getOwnPropertyDescriptors(object.prototype))
		.filter(([key]) => key !== "constructor")
		.map(([, value]) => value);

	return functions;
}
export function getFunction(object: Constructable, functionName: string) {
	const [, value] = Object.entries(Object.getOwnPropertyDescriptors(object.prototype)).find(
		([k]) => k !== "constructor" && k === functionName,
	);

	return value;
}
export function getFunctionMetadata<T>(key: string, target: object, func: FunctionType) {
	const meta = Reflect.getMetadata(key, target, func.name) as T;
	return meta;
}
export function getFunctionArgs(target: object, func: FunctionType): Type[] {
	const meta = getFunctionMetadata<Type[]>(ReflectionMeta.paramtypes, target, func);
	return meta;
}

/**
 * @description Gets the fields from an object
 * @param object
 * @returns
 */
export function getFields<T>(object: T) {
	const fields = Object.entries(Object.getOwnPropertyDescriptors(object))
		.filter(([, val]) => typeof val.value !== "function")
		.map<Field>(([key, propertyDescriptor]) => ({ key, propertyDescriptor }));
	return fields;
}
export function getFieldType(target: object, fieldName: string) {
	return Reflect.getMetadata(ReflectionMeta.type, target, fieldName) as Type;
}
export function getArgumentMeta<T>(key: string, target: FunctionType, argIndex: number) {
	const meta = Reflect.getMetadata(key, target, argIndex.toString()) as T;
	return meta;
}
export function defineMeta<T>(key: string, value: T, target: object) {
	Reflect.defineMetadata(key, value, target);
}
/**
 * @description Facade function to define metadata for a function argument
 * @param key
 * @param value
 * @param func
 * @param argIndex
 */

export function defineArgumentMeta<T>(
	key: string,
	value: T,
	func: FunctionType,
	argIndex: number,
) {
	Reflect.defineMetadata(key, value, func, argIndex.toString());
}
