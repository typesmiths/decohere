import { vi } from "vitest";
import type { Constructable } from "../src/reflection/index.js";

export function mockPrototype<T extends object>(obj: Constructable<T>): T {
	const funcs = Object.entries(Object.getOwnPropertyDescriptors(obj.prototype)).filter(
		([, prop]) => typeof prop.value === "function",
	);
	const mock = Object.fromEntries(funcs.map(([key]) => [key, vi.fn()]));
	const instance = new obj();
	Object.assign(instance, mock);
	return instance;
}
