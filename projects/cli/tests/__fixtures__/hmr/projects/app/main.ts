import { vol } from "memfs";
import { value } from "./dep-a.js";

const app = {
	value,
	async [Symbol.asyncDispose]() {
		vol.writeFileSync("/disposed.txt", "1");
	},
};

export default app;
