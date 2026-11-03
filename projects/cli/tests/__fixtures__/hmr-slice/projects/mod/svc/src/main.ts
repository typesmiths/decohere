import { vol } from "memfs";

vol.writeFileSync("/slice-svc-booted", "1");

export default {
	async [Symbol.asyncDispose]() {},
};
