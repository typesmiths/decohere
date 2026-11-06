import type { Builder } from "@decohere/core/hosting";
import { HttpOptions } from "./http.options.js";

const httpOptionsStore = new WeakMap<Builder, HttpOptions>();

/**
 * The {@link HttpOptions} a builder collects through its extensions. Internal: lets extensions
 * outside `http.extensions.ts` (`withHealth`) set an option without a public builder method.
 */
export function getOrCreateHttpOptions(builder: Builder): HttpOptions {
	let options = httpOptionsStore.get(builder);
	if (options == null) {
		options = new HttpOptions();
		httpOptionsStore.set(builder, options);
	}
	return options;
}
