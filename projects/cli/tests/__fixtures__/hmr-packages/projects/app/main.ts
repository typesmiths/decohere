// @ts-expect-error fixture workspace package — Flux/Forge resolve it, repo tsc does not
import { foo } from "@hmr/lib";
import { vol } from "memfs";

vol.writeFileSync("/observed.json", JSON.stringify({ foo }));

export default {
	async [Symbol.asyncDispose]() {},
};
