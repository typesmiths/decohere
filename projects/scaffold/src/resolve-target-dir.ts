/**
 * Resolve scaffold destination: positional `webapi my-app` wins over `-d`.
 * `npm create … webapi -d my-app` drops `-d` (npm loglevel) and forwards `my-app`.
 */
export function resolveTargetDir(positional?: string, flag?: string): string {
	const dir = positional?.trim() || flag?.trim() || ".";
	return dir;
}
