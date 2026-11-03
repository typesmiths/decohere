/**
 * The module specifiers a compiled ES module names in `import … from`, `export … from`, bare
 * `import "x"` and literal `import("x")`.
 *
 * Only a hint for compiling ahead: a specifier it misses is compiled when Node loads it,
 * and one it finds by mistake (an import written inside a string) costs one extra compile. So a
 * scan of SWC's output is enough; it never decides what runs.
 */
const STATIC = /\b(?:import|export)\s*(?:[\w$*{},\s]+?\s*from\s*)?["']([^"'\n]+)["']/g;
const DYNAMIC = /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g;

function scan(code: string): string[] {
	const found = new Set<string>();
	for (const pattern of [STATIC, DYNAMIC]) {
		for (const match of code.matchAll(pattern)) {
			const specifier = match[1];
			if (specifier != null) found.add(specifier);
		}
	}
	return [...found];
}

export const staticImports = { scan };
