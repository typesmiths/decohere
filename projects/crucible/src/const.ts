import type { Scope } from "./types/types.js";

export { ContainerMeta, LifetimeScopeToken } from "@decohere/core/composition";

export const Scopes = {
	request: "request",
	singleton: "single-instance",
	transient: "transient",
} satisfies Record<string, Scope>;
