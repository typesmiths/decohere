import { vol } from "memfs";
import { value } from "./dep-a.js";

vol.writeFileSync("/flux-run.json", JSON.stringify({ value, argv: process.argv.slice(2) }));
