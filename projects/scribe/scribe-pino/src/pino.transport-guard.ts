import type { DestinationStream } from "pino";

export type GuardedTransport = DestinationStream & {
	readonly retired: boolean;
	retire(reason?: string): void;
};

type WritableLike = DestinationStream & {
	write?: (...args: never[]) => unknown;
	on?: (event: "error", listener: (err: Error) => void) => unknown;
	destroy?: (error?: Error) => void;
};

/**
 * Wrap a pino worker transport so a dead ThreadStream cannot spam or crash.
 * On first error / write throw: report once, destroy, no-op further writes.
 */
export function guardTransport(transport: DestinationStream): GuardedTransport {
	const stream = transport as WritableLike;
	let retired = false;
	let reported = false;

	const retire = (reason = "retired"): void => {
		if (retired) {
			return;
		}
		retired = true;
		if (!reported) {
			reported = true;
			process.stderr.write(`[scribe-pino] transport retired: ${reason}\n`);
		}
		if (typeof stream.destroy === "function") {
			try {
				stream.destroy();
			} catch {
				// already dead
			}
		}
	};

	if (typeof stream.on === "function") {
		stream.on("error", (err) => {
			retire(err?.message ?? String(err));
		});
	}

	if (typeof stream.write === "function") {
		const originalWrite = stream.write.bind(stream) as (
			chunk: unknown,
			encodingOrCb?: unknown,
			cb?: unknown,
		) => unknown;

		stream.write = ((chunk: unknown, encodingOrCb?: unknown, cb?: unknown) => {
			if (retired) {
				completeWrite(encodingOrCb, cb);
				return true;
			}
			try {
				return originalWrite(chunk, encodingOrCb, cb);
			} catch (err) {
				retire(err instanceof Error ? err.message : String(err));
				completeWrite(encodingOrCb, cb);
				return true;
			}
		}) as typeof stream.write;
	}

	Object.defineProperty(stream, "retired", {
		get: () => retired,
		enumerable: true,
	});
	Object.defineProperty(stream, "retire", {
		value: retire,
		enumerable: true,
	});

	return stream as GuardedTransport;
}

function completeWrite(encodingOrCb: unknown, cb: unknown): void {
	const done =
		typeof encodingOrCb === "function"
			? encodingOrCb
			: typeof cb === "function"
				? cb
				: undefined;
	if (typeof done === "function") {
		done();
	}
}
