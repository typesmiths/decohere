/** Normalize a prefix to `/foo` form with no trailing slash. Empty → `""`. */
export function normalizePrefix(prefix: string | undefined | null): string {
	if (prefix == null || prefix === "" || prefix === "/") {
		return "";
	}
	const withSlash = prefix.startsWith("/") ? prefix : `/${prefix}`;
	return withSlash.replace(/\/+$/, "");
}

/**
 * Join a controller prefix with a method-relative route path.
 * Preserves `@Get("/")` trailing-slash semantics (`/hello` + `/` → `/hello/`).
 */
export function joinRoutePath(prefix: string, routePath: string): string {
	const p = normalizePrefix(prefix);
	if (routePath === "" || routePath == null) {
		return p === "" ? "/" : p;
	}
	if (routePath === "/") {
		return p === "" ? "/" : `${p}/`;
	}
	if (!routePath.startsWith("/")) {
		throw new Error(`Route path must start with '/': ${routePath}`);
	}
	return `${p}${routePath}`;
}

/** Prepend a global prefix onto an already-joined controller route path. */
export function applyGlobalPrefix(globalPrefix: string, path: string): string {
	const g = normalizePrefix(globalPrefix);
	if (g === "") {
		return path === "" ? "/" : path;
	}
	if (path === "/") {
		return `${g}/`;
	}
	return `${g}${path.startsWith("/") ? path : `/${path}`}`;
}
