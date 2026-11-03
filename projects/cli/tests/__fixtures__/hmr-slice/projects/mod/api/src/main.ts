import { vol } from "memfs";

vol.writeFileSync("/slice-api-booted", "1");

export default {
	async [Symbol.asyncDispose]() {},
};
