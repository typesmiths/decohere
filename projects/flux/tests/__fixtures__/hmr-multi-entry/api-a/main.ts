import { vol } from "memfs";

vol.writeFileSync("/multi-a-booted", "1");

export default {
	async [Symbol.asyncDispose]() {},
};
