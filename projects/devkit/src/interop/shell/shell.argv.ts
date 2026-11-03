function fields(args: string[]): Record<string, string | boolean | string[]> {
	const positional: string[] = [];
	const flags: Record<string, string | boolean> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") {
			positional.push(...args.slice(i + 1));
			break;
		}
		if (arg.startsWith("--")) {
			const body = arg.slice(2);
			const eq = body.indexOf("=");
			if (eq !== -1) {
				flags[body.slice(0, eq)] = body.slice(eq + 1);
				continue;
			}
			const next = args[i + 1];
			if (next != null && !next.startsWith("-")) {
				flags[body] = next;
				i += 1;
			} else {
				flags[body] = true;
			}
			continue;
		}
		positional.push(arg);
	}
	return { _: positional, ...flags };
}

export const shellArgv = { fields };
