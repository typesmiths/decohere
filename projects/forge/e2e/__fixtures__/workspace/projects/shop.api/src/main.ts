import { readFileSync } from "node:fs";
import { describeDuration } from "@fixture/kernel";
import { SECOND } from "@fixture/kernel/clock";
import { greet } from "./greet.js";

const config = readFileSync("./config/config.yaml", "utf8").trim();
console.log(
	JSON.stringify({ greeting: greet(), duration: describeDuration(60 * SECOND), config }),
);
