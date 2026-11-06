import path from "node:path";
import picomatch from "picomatch";
import { isDevelopmentNodeEnv } from "../auth/auth.types.js";

/**
 * Serving a module's built UI from its API (the `statics` setting). Everything here is
 * provider-neutral: the options, the caching rules and the missing-directory policy.
 * Only the HTTP provider knows how to put files on the wire. See ADR 0007.
 */

/** Cache header for files whose name carries a content hash. The name changes when the content does. */
export const STATIC_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Cache header for files that must be revalidated on every use (the entry points of a UI). */
export const STATIC_NO_CACHE_CONTROL = "no-cache";

/** Cache header for every other file: cacheable, but always revalidated (ETag / Last-Modified). */
export const STATIC_DEFAULT_CACHE_CONTROL = "public, max-age=0, must-revalidate";

/**
 * The entry points of a UI. `index.html` names the hashed bundles, and a module-federation host
 * loads `remoteEntry.js` by a fixed name to find the current remote, so neither can be cached.
 */
export const STATIC_DEFAULT_NO_CACHE: readonly string[] = ["index.html", "remoteEntry.js"];

/**
 * A build tool's hashed file name: `index-DiwrgTda.js`, `chunk.3f9a8c1b.css`, `app-abc123de.js.map`.
 * The hash is 8 or more letters, digits or `_` after a `-` or `.`, and holds a digit or a lowercase
 * letter followed by an uppercase one. Plain words (`logo-background.png`) are not hashes.
 */
export const STATIC_DEFAULT_IMMUTABLE =
	/[.-](?=[A-Za-z0-9_]*(?:\d|[a-z][A-Z]))[A-Za-z0-9_]{8,}\.[A-Za-z0-9]+(?:\.map)?$/;

export type StaticOptions = {
	/**
	 * Serve `index.html` for an unknown path under the prefix, so a client-side route survives a
	 * reload. Only for GET and HEAD, and never for a path that looks like a file (has an
	 * extension), so a missing asset stays a 404. Defaults to `true`.
	 */
	spaFallback?: boolean;
	/**
	 * Path patterns this mount never answers, neither a file nor the fallback: the request gets the
	 * normal JSON 404. Globs on the full request path (not relative to the prefix), for example
	 * `["/api/**", "/docs/**"]`: `*` is any run of characters inside one segment, `**` crosses
	 * segments, `?` is one character. `/api/**` also covers `/api` itself. Rarely needed: a path
	 * that starts with the first segment of a registered controller route is already never
	 * answered with the fallback (see `staticFiles.isUnderRoute`).
	 */
	exclude?: string[];
	/** The file served for the prefix itself and for the fallback. Defaults to `index.html`. */
	index?: string;
	/**
	 * Files sent with `Cache-Control: no-cache`, by file name (`index.html`) or by path relative to
	 * the directory (`remote/remoteEntry.js`). Replaces the default `["index.html", "remoteEntry.js"]`,
	 * so list `index.html` again if you override it.
	 */
	noCache?: string[];
	/**
	 * Files whose name holds a content hash get `public, max-age=31536000, immutable`. Replace the
	 * pattern if your build names files differently (it is tested against the path relative to the
	 * directory), or pass `false` to give no file the immutable header.
	 */
	immutable?: RegExp | false;
	/** `Cache-Control` for every other file. Defaults to `public, max-age=0, must-revalidate`. */
	cacheControl?: string;
	/**
	 * What to do when the directory does not exist at start. `"fail"` stops the app with an error;
	 * `"warn"` logs a warning and serves nothing, so the API still boots before the UI is built.
	 * Defaults to `"warn"` when NODE_ENV is `development` or `dev`, and to `"fail"` otherwise.
	 */
	onMissingDirectory?: "fail" | "warn";
};

/** A `statics` call, as the builder keeps it. */
export type StaticMount = {
	/** Normalised: starts and ends with `/`, for example `/ui/`. */
	prefix: string;
	/** As given by the caller, resolved from the process working directory when the app starts. */
	directory: string;
	options: StaticOptions;
};

/** A mount the provider can register: the directory exists and every option has its value. */
export type ResolvedStaticMount = {
	prefix: string;
	/** Absolute path of the directory. */
	root: string;
	spaFallback: boolean;
	index: string;
	noCache: readonly string[];
	immutable: RegExp | false;
	cacheControl: string;
	exclude: readonly string[];
};

/** `"ui"`, `"/ui"` and `"/ui/"` all mean `/ui/`; `"/"` is the root. Refuses an empty prefix. */
function normalizePrefix(prefix: string): string {
	const segments = prefix.split("/").filter((segment) => segment !== "");
	if (segments.length === 0) {
		if (prefix.trim() === "") {
			throw new Error('A static mount needs a prefix, such as "/ui/" or "/" for the root.');
		}
		return "/";
	}
	if (
		segments.some((segment) => segment === "." || segment === ".." || /[*:?]/.test(segment))
	) {
		throw new Error(`Static prefix "${prefix}" must be plain path segments, such as "/ui/".`);
	}
	return `/${segments.join("/")}/`;
}

function toMount(prefix: string, directory: string, options: StaticOptions = {}): StaticMount {
	if (directory.trim() === "") {
		throw new Error(
			`Static files at "${prefix}" need the directory that holds the built files.`,
		);
	}
	return { prefix: normalizePrefix(prefix), directory, options };
}

type DirectoryProbe = (absolutePath: string) => Promise<boolean>;

export type ResolveStaticOptions = {
	/** Where relative directories are resolved from. Defaults to the process working directory. */
	cwd?: string;
	nodeEnv?: string;
	directoryExists: DirectoryProbe;
	warn: (message: string) => void;
};

/**
 * Checks every mount at start. Returns the ones that can be served; a missing directory fails or
 * warns according to the mount's `onMissingDirectory`. Two mounts on one prefix always fail.
 */
async function resolve(
	mounts: readonly StaticMount[],
	env: ResolveStaticOptions,
): Promise<ResolvedStaticMount[]> {
	const cwd = env.cwd ?? process.cwd();
	const resolved: ResolvedStaticMount[] = [];
	const seen = new Set<string>();
	for (const mount of mounts) {
		if (seen.has(mount.prefix)) {
			throw new Error(`statics: ${mount.prefix} is mounted twice.`);
		}
		seen.add(mount.prefix);

		const root = path.resolve(cwd, mount.directory);
		if (!(await env.directoryExists(root))) {
			const policy =
				mount.options.onMissingDirectory ??
				(isDevelopmentNodeEnv(env.nodeEnv) ? "warn" : "fail");
			const message =
				`statics "${mount.prefix}" at "${mount.directory}": ${root} does not exist. ` +
				"Build the UI first, or run the app from the folder that holds it.";
			if (policy === "fail") {
				throw new Error(message);
			}
			env.warn(
				`${message} ${mount.prefix} will answer 404 until it is built and the app restarts.`,
			);
			continue;
		}

		const options = mount.options;
		resolved.push({
			prefix: mount.prefix,
			root,
			spaFallback: options.spaFallback ?? true,
			index: options.index ?? "index.html",
			noCache: options.noCache ?? STATIC_DEFAULT_NO_CACHE,
			immutable: options.immutable ?? STATIC_DEFAULT_IMMUTABLE,
			cacheControl: options.cacheControl ?? STATIC_DEFAULT_CACHE_CONTROL,
			exclude: options.exclude ?? [],
		});
	}
	return resolved;
}

/** `Cache-Control` for a file, given its path relative to the mount's directory. */
function cacheControlFor(mount: ResolvedStaticMount, relativePath: string): string {
	const posix = relativePath.split(path.sep).join("/");
	const name = path.posix.basename(posix);
	if (mount.noCache.some((entry) => entry === name || entry === posix)) {
		return STATIC_NO_CACHE_CONTROL;
	}
	if (mount.immutable !== false && mount.immutable.test(posix)) {
		return STATIC_IMMUTABLE_CACHE_CONTROL;
	}
	return mount.cacheControl;
}

/**
 * Does this path look like a file: an extension on the last segment, or a dotfile anywhere?
 * Then a miss is a real 404, not a client-side route.
 */
function looksLikeFile(pathname: string): boolean {
	const segments = pathname.split("/").filter((segment) => segment !== "");
	if (segments.some((segment) => segment.startsWith("."))) {
		return true;
	}
	const last = pathname.endsWith("/") ? undefined : segments.at(-1);
	return last?.includes(".") === true;
}

/** The request path as the mount sees it: no query, decoded, repeated slashes collapsed. */
function normalizePathname(url: string): string {
	const raw = url.split("?")[0] ?? "";
	let decoded = raw;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		// Keep the raw text: a malformed escape is matched as written.
	}
	return decoded.replace(/\/{2,}/g, "/");
}

/** Builds the test for a mount's `exclude` patterns. Matches on the normalised path. */
function excluder(patterns: readonly string[]): (pathname: string) => boolean {
	if (patterns.length === 0) {
		return () => false;
	}
	const matches = picomatch([...patterns], { dot: true });
	return (pathname) => matches(pathname);
}

/**
 * The first path segment of every registered route, for {@link isUnderRoute}. A segment that is a
 * parameter or wildcard (`:id`, `*`) says nothing about the path and is skipped.
 */
function routeSegments(routePaths: Iterable<string>): Set<string> {
	const segments = new Set<string>();
	for (const routePath of routePaths) {
		const first = routePath.split("/").find((segment) => segment !== "");
		if (first != null && !/[:*]/.test(first)) {
			segments.add(first);
		}
	}
	return segments;
}

/**
 * Is this path under one of the app's own routes? True when its first segment is the first
 * segment of a registered route: with a controller route `/lp/portfolio`, `/lp/portfolo` and
 * `/lp/anything/else` belong to the API and keep the JSON 404, while `/lpx` does not.
 */
function isUnderRoute(pathname: string, segments: ReadonlySet<string>): boolean {
	const first = pathname.split("/").find((segment) => segment !== "");
	return first != null && segments.has(first);
}

/** Is `pathname` the path `base` or below it? `/api` holds `/api` and `/api/x`, not `/apiary`. */
function isWithin(pathname: string, base: string): boolean {
	const trimmed = base.replace(/\/+$/, "");
	return pathname === trimmed || pathname.startsWith(`${trimmed}/`);
}

/**
 * The literal start of a route path, up to its first parameter or wildcard: `/webhooks/:id` gives
 * `/webhooks`, `/:id` gives `""`.
 */
function staticStem(routePath: string): string {
	const stem: string[] = [];
	for (const segment of routePath.split("/")) {
		if (segment.startsWith(":") || segment.includes("*")) {
			break;
		}
		if (segment !== "") {
			stem.push(segment);
		}
	}
	return stem.length === 0 ? "" : `/${stem.join("/")}`;
}

/**
 * What the fallback treats as the API, as a test on the normalised path. With a global prefix it
 * is the prefix, the OpenAPI path and every route left outside the prefix
 * (`@Controller({ globalPrefix: false })`, such as `/health`), each with the paths below it, so a
 * client route may share a first segment with a controller. Without a prefix it is
 * {@link isUnderRoute} (the first segment of every registered route), the safe guess when nothing
 * says where the API lives.
 */
function apiBoundary(boundary: {
	/** Normalised global prefix (`/api`), or `""` when there is none. */
	globalPrefix: string;
	openApiPath?: string;
	/** Every registered route path, global prefix included. */
	routePaths: Iterable<string>;
}): (pathname: string) => boolean {
	if (boundary.globalPrefix === "") {
		const segments = routeSegments([
			...boundary.routePaths,
			...(boundary.openApiPath == null ? [] : [boundary.openApiPath]),
		]);
		return (pathname) => isUnderRoute(pathname, segments);
	}
	const outside = [...boundary.routePaths]
		.filter((routePath) => !isWithin(routePath, boundary.globalPrefix))
		.map(staticStem)
		.filter((stem) => stem !== "");
	const bases = [boundary.globalPrefix, boundary.openApiPath, ...outside].filter(
		(base): base is string => base != null,
	);
	return (pathname) => bases.some((base) => isWithin(pathname, base));
}

/** Does the `Accept` header ask for HTML (a browser navigation)? `text/html;q=0` does not. */
function acceptsHtml(accept: string | undefined): boolean {
	if (accept == null) {
		return false;
	}
	return accept.split(",").some((entry) => {
		const [type = "", ...params] = entry.split(";").map((part) => part.trim().toLowerCase());
		if (type !== "text/html") {
			return false;
		}
		const quality = params.find((param) => param.startsWith("q="));
		return quality == null || Number.parseFloat(quality.slice(2)) > 0;
	});
}

export type FallbackRequest = {
	method: string;
	/** Normalised, see `normalizePathname`. */
	pathname: string;
	accept: string | undefined;
};

/**
 * Should an unknown path get the app's `index.html`? Only a browser navigation: GET or HEAD, no
 * file extension and no dotfile in the path, an `Accept` that includes `text/html`, and not under
 * the API (see {@link apiBoundary}). Everything else keeps the normal JSON 404.
 */
function shouldFallBack(
	request: FallbackRequest,
	belongsToApi: (pathname: string) => boolean,
): boolean {
	return (
		(request.method === "GET" || request.method === "HEAD") &&
		acceptsHtml(request.accept) &&
		!looksLikeFile(request.pathname) &&
		!belongsToApi(request.pathname)
	);
}

export const staticFiles = {
	toMount,
	resolve,
	cacheControlFor,
	looksLikeFile,
	normalizePathname,
	excluder,
	routeSegments,
	isUnderRoute,
	apiBoundary,
	acceptsHtml,
	shouldFallBack,
};
