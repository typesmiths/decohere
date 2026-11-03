#!/usr/bin/env node
import { runCli } from "./program.js";

// Exit as soon as the command is done, without waiting for handles it left open.
process.exit(await runCli());
