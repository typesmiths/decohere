export type Constructable<T extends object = object> = {
	new (...args: any[]): T;
} & Type;

export type Field = {
	key: string;
	propertyDescriptor: PropertyDescriptor;
};

export type FunctionType = (
	...args: unknown[]
) => unknown | unknown[] | undefined | Promise<unknown>;
export type ReflectMeta = "paramtypes" | "type";

export const MetaDataOwners = {
	Reflect: "design",
} satisfies Record<string, string>;

export const ReflectionMeta = {
	paramtypes: `${MetaDataOwners.Reflect}:paramtypes`,
	type: `${MetaDataOwners.Reflect}:type`,
} satisfies Record<ReflectMeta, string>;

export type Type = {
	prototype: object;
	name?: string;
};
