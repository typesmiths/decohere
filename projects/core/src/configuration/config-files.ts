/** Which environment a process with no NODE_ENV, and a package, are for. */
export const DEFAULT_CONFIG_ENV = "production";

const NAME = /^[A-Za-z0-9_-]+$/;
const CONFIG_FILE = /^config(?:\.[A-Za-z0-9_-]+){0,2}\.yaml$/;

/** A valid app or environment name: it fills one part of a config file's name. */
export function isConfigNamePart(name: string): boolean {
	return NAME.test(name);
}

/** True when a file fits `config.{optional app}.{optional env}.yaml`. */
export function isConfigFileName(fileName: string): boolean {
	return CONFIG_FILE.test(fileName);
}

/**
 * The config files for these apps and environments, later ones winning:
 * `config.yaml`, `config.<app>.yaml`, `config.<env>.yaml`, `config.<app>.<env>.yaml`.
 *
 * Names are built from what's given and never parsed, so `config.dev.yaml` can't be misread.
 *
 * @throws if a name can't be part of a file name, or an app has the same name as an environment,
 * since `config.<name>.yaml` would then mean both.
 */
export function configFileNames(apps: readonly string[], envs: readonly string[]): string[] {
	for (const name of [...apps, ...envs]) {
		if (!isConfigNamePart(name)) {
			throw new Error(
				`${JSON.stringify(name)} can't name a config file: use letters, digits, "-" and "_"`,
			);
		}
	}
	const clash = apps.find((app) => envs.includes(app));
	if (clash != null) {
		throw new Error(
			`"${clash}" is both an app and an environment, so config.${clash}.yaml would mean both`,
		);
	}
	return [
		"config.yaml",
		...apps.map((app) => `config.${app}.yaml`),
		...envs.map((env) => `config.${env}.yaml`),
		...apps.flatMap((app) => envs.map((env) => `config.${app}.${env}.yaml`)),
	];
}
