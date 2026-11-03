import { aValue } from "./dep-a.js";
import { cValue } from "./dep-c.js";

export default {
	aValue,
	cValue,
	async [Symbol.asyncDispose]() {},
};
