import type * as NodeFsPromises from "node:fs/promises";
import { fs } from "memfs";

export default fs.promises as unknown as typeof NodeFsPromises;
export const stat: typeof NodeFsPromises.stat = fs.promises.stat as typeof NodeFsPromises.stat;
export const mkdir: typeof NodeFsPromises.mkdir = fs.promises
	.mkdir as typeof NodeFsPromises.mkdir;
export const mkdtemp: typeof NodeFsPromises.mkdtemp = fs.promises
	.mkdtemp as typeof NodeFsPromises.mkdtemp;
export const rm: typeof NodeFsPromises.rm = fs.promises.rm as typeof NodeFsPromises.rm;
export const writeFile: typeof NodeFsPromises.writeFile = fs.promises
	.writeFile as typeof NodeFsPromises.writeFile;
export const readFile: typeof NodeFsPromises.readFile = fs.promises
	.readFile as typeof NodeFsPromises.readFile;
