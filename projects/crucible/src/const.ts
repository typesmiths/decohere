import type { Scope } from "./types/types.js";

const Container = "Container";
type ContainerMeta = "injecttoken";

export const LifetimeScopeToken = Symbol("LifetimeScope");

export const ContainerMeta = {
	injecttoken: `${Container}:injecttoken`,
} satisfies Record<ContainerMeta, string>;

export const Scopes = {
	request: "request",
	singleton: "single-instance",
	transient: "transient",
} satisfies Record<string, Scope>;
