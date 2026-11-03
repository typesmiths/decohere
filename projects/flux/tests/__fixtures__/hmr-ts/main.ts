import { vol } from "memfs";
import { value } from "./dep-a.js";

export default {
	value,
	async [Symbol.asyncDispose]() {
		vol.writeFileSync("/disposed.txt", "1");
	},
};
