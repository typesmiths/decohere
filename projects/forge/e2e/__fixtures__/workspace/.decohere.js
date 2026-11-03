/** @type {import("@decohere/workspace").WorkspaceOptions} */
const config = {
	projects: {
		"@fixture/shop.api": {
			// The "built" UI is committed as projects/shop.web/build (dist/ is git-ignored).
			ui: { project: "@fixture/shop.web", output: "build" },
		},
	},
};

export default config;
