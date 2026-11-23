/**
 * This repo's own settings for forge and flux, over their defaults.
 *
 * @type {import("@decohere/workspace").WorkspaceOptions}
 */
export default {
	projects: {
		"@decohere/scaffold": {
			// The recipes and add steps are apps the scaffolder copies, not its own code. They are
			// left out of its build, and their imports out of its dependencies, and ship as files.
			// Globs skip dotfiles unless a segment starts with a dot.
			ignore: ["templates/**"],
			copyFiles: ["templates/**", "templates/**/.*", "templates/**/.*/**"],
		},
	},
};
