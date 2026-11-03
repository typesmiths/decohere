type GlobFn = (typeof import("glob"))["glob"];

export const glob = ((..._args: unknown[]) => {
	throw new Error(
		'Mocked "glob" was called without an explicit test override. See docs/testing/how-tos/vitest-glob-automock-fail-fast.md for the recommended pattern.',
	);
}) as unknown as GlobFn;

const mockedGlob: { glob: GlobFn } = {
	glob,
};

export default mockedGlob;
