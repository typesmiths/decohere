import { vol } from "memfs";

vol.writeFileSync("/multi-b-booted", "1");

export default {
	async [Symbol.asyncDispose]() {},
};
