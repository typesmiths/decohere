import type { Builder } from "@decohere/core/hosting";
import { HttpOptions } from "./http.options.js";

const httpOptionsStore = new WeakMap<Builder, HttpOptions>();

/**
 * The {@link HttpOptions} a builder collects through its plugins. Internal: lets plugins outside
 * `http.plugin.ts` (`health`) set an option with no public setting for it.
 */
export function getOrCreateHttpOptions(builder: Builder): HttpOptions {
	let options = httpOptionsStore.get(builder);
	if (options == null) {
		options = new HttpOptions();
		httpOptionsStore.set(builder, options);
	}
	return options;
}
