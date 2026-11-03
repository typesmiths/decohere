import { type SpawnOptions, spawn } from "node:child_process";
import { scribe } from "@decohere/scribe";
import { InteropError } from "../errors/interop.error.js";
import { shellArgv } from "./shell.argv.js";
import type { ShellOptions, ShellResponse } from "./shell.types.js";

export abstract class Shell {
	protected abstract program: string;
	protected async run(options: ShellOptions, ...args: string[]) {
		const logger = scribe.logger(Shell.name);
		const argv = args ?? [];
		const argvFields = shellArgv.fields(argv);
		const positionals = Array.isArray(argvFields._) ? argvFields._ : [];
		const commandName = [this.program, ...positionals].join(" ").trim();
		logger.info("Running", { program: this.program, args: argvFields });
		return new Promise<ShellResponse>((resolve, reject) => {
			let settled = false;
			const resolveOnce = (response: ShellResponse) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(response);
			};

			const rejectOnce = (error: unknown) => {
				if (settled) {
					return;
				}
				settled = true;
				reject(error);
			};

			const { cwd, env } = options;
			const spawnOpt: SpawnOptions = {
				cwd: cwd ?? ".",
				stdio: ["inherit", "pipe", "pipe"],
				env: env ?? { ...process.env },
			};

			const proc = spawn(this.program, argv, spawnOpt);
			const responseData: string[] = [];
			const errorData: string[] = [];

			proc.on("close", (code, signal) => {
				if (code === 0) {
					resolveOnce({
						message: `${commandName} completed`,
						data: responseData,
					});
					return;
				}

				const stderr = errorData.join("\n").trim();
				const stdout = responseData.join("\n").trim();
				const exitCodeText = code == null ? "unknown" : String(code);
				const signalText = signal ? ` signal ${signal}` : "";
				const base = `Running '${commandName}' failed with code ${exitCodeText}${signalText}`;
				const details = [
					stderr ? `stderr:\n${stderr}` : "",
					!stderr && stdout ? `stdout:\n${stdout}` : "",
				]
					.filter(Boolean)
					.join("\n");

				rejectOnce(new InteropError(details ? `${base}\n${details}` : base));
			});

			proc.on("error", (err) => {
				rejectOnce(err);
			});

			proc.stdout.on("error", (err) => {
				rejectOnce(err);
			});

			proc.stdout.on("data", (data) => {
				const lines = this.parseStream(data);
				console.log(data.toString());
				responseData.push(...lines);
			});

			proc.stderr?.on("error", (err) => {
				rejectOnce(err);
			});

			proc.stderr?.on("data", (data) => {
				const lines = this.parseStream(data);
				console.error(data.toString());
				errorData.push(...lines);
			});
		});
	}

	private parseStream(data: Buffer | string) {
		const dataStr: string = data.toString();
		const lines = dataStr.split("\n").filter((l) => l !== "");
		return lines;
	}
}
