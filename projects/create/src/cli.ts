#!/usr/bin/env node
import { runInBuilder } from "./runner.js";

runInBuilder(process.argv.slice(2));
