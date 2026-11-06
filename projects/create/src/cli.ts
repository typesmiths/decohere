#!/usr/bin/env node
import { launch } from "./runner.js";

await launch(process.argv.slice(2));
