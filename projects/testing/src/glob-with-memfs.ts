import { fs } from "memfs";

// Wraps a real `glob` module so all file-system access is routed through memfs.
//
// Why this exists:
// - Integration tests often need real glob matching semantics.
// - Vitest `vi.mock` factories are hoisted, so directly importing and patching
//   `glob` inside helper modules can trigger initialization-order issues.
// - Passing the already-loaded `actual` module keeps the helper pure and
//   hoist-safe while still allowing us to inject memfs.
export function withMemfsFsForGlob<
	TGlobModule extends { glob: (...args: unknown[]) => unknown },
>(actual: TGlobModule): TGlobModule {
	// Preserve all module exports, overriding only `glob` to force `{ fs: memfs }`.
	const glob = ((pattern: string | string[], options?: unknown) =>
		(actual.glob as (...args: unknown[]) => unknown)(pattern, {
			...(options as Record<string, unknown> | undefined),
			fs,
		})) as TGlobModule["glob"];

	return {
		...actual,
		glob,
	};
}
