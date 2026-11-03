import { createInterface, type Interface } from "node:readline";

// readline/promises rl.question() has a race condition with piped (non-TTY) stdin
// in Node ≥ 22: after the first line is read, stdin emits 'end', readline closes,
// and all subsequent question() calls resolve to "".
// Fix: use the async-iterator API, which buffers all lines before the close event fires.

let _rl: Interface | null = null;
let _lines: AsyncIterator<string> | null = null;

function getLines(): AsyncIterator<string> {
	if (_lines == null) {
		_rl = createInterface({ input: process.stdin, terminal: false });
		_lines = _rl[Symbol.asyncIterator]();
	}
	return _lines;
}

/** Release stdin so the process can exit after interactive prompts. */
export function closePrompt(): void {
	_rl?.close();
	_rl = null;
	_lines = null;
}

async function readLine(prompt: string): Promise<string> {
	process.stdout.write(prompt);
	const { value, done } = await getLines().next();
	return done ? "" : value.trim();
}

export async function ask(question: string, fallback = ""): Promise<string> {
	const answer = await readLine(question);
	return answer || fallback;
}

export async function pick<T>(
	label: string,
	items: T[],
	display: (item: T) => string,
): Promise<T | null> {
	console.log(label.trimEnd());
	for (const [i, item] of items.entries()) {
		console.log(`    ${i + 1}. ${display(item)}`);
	}
	const answer = await readLine("  > ");
	const idx = Number.parseInt(answer, 10);
	if (Number.isNaN(idx) || idx < 1 || idx > items.length) return null;
	return items[idx - 1];
}
