/**
 * Parses JSON with comments and trailing commas, as `tsconfig.json` allows. An empty file is
 * `{}`, as tsc reads it. Throws a `SyntaxError` on anything else that isn't valid JSON.
 */
export function parseJsonc(text: string): unknown {
	if (text.trim() === "") return {};
	return JSON.parse(stripJsonc(text));
}

function stripJsonc(text: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const char = text[i];
		const next = text[i + 1];
		if (char === '"') {
			const end = stringEnd(text, i);
			out += text.slice(i, end);
			i = end;
		} else if (char === "/" && next === "/") {
			const end = text.indexOf("\n", i);
			i = end === -1 ? text.length : end;
		} else if (char === "/" && next === "*") {
			const end = text.indexOf("*/", i + 2);
			if (end === -1) throw new SyntaxError("Unterminated comment in JSON");
			out += " ";
			i = end + 2;
		} else if (char === "}" || char === "]") {
			// Drop a trailing comma before the closing bracket.
			out = out.trimEnd();
			if (out.endsWith(",")) out = out.slice(0, -1);
			out += char;
			i++;
		} else {
			out += char;
			i++;
		}
	}
	return out;
}

/** Index just past the string starting at `start` (a `"`); an unclosed string runs to the end. */
function stringEnd(text: string, start: number): number {
	let i = start + 1;
	while (i < text.length) {
		if (text[i] === "\\") i += 2;
		else if (text[i] === '"') return i + 1;
		else i++;
	}
	return text.length;
}
