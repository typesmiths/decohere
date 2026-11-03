import type * as NodeFs from "node:fs";
import { fs } from "memfs";

export default fs;
export const promises: typeof NodeFs.promises =
	fs.promises as unknown as typeof NodeFs.promises;
export const watch: typeof NodeFs.watch = fs.watch as unknown as typeof NodeFs.watch;
export const readdirSync: typeof NodeFs.readdirSync =
	fs.readdirSync as typeof NodeFs.readdirSync;
export const statSync: typeof NodeFs.statSync = fs.statSync as typeof NodeFs.statSync;
export const readFileSync: typeof NodeFs.readFileSync =
	fs.readFileSync as typeof NodeFs.readFileSync;
export const writeFileSync: typeof NodeFs.writeFileSync =
	fs.writeFileSync as typeof NodeFs.writeFileSync;
export const mkdirSync: typeof NodeFs.mkdirSync = fs.mkdirSync as typeof NodeFs.mkdirSync;
export const existsSync: typeof NodeFs.existsSync = fs.existsSync as typeof NodeFs.existsSync;
