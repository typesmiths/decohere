import { vi } from "vitest";

export const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");

vi.mock("fs");
vi.mock("fs/promises");
vi.mock("node:fs");
vi.mock("node:fs/promises");
vi.mock("glob", async () => {
	const actual = await vi.importActual<typeof import("glob")>("glob");
	const { withMemfsFsForGlob } = await import("@decohere/testing");
	return withMemfsFsForGlob(actual);
});
