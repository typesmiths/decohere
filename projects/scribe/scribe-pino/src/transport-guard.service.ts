import type { DestinationStream } from "pino";

type WritableLike = DestinationStream & {
	write?: (...args: never[]) => unknown;
	on?: (event: "error", listener: (err: Error) => void) => unknown;
	destroy?: (error?: Error) => void;
};

type Write = (chunk: unknown, encodingOrCb?: unknown, cb?: unknown) => unknown;

/**
 * Keeps a dead Pino worker transport from crashing the process or failing every write after it.
 * On the transport's first error, or a write that throws, it reports once on stderr, destroys the
 * transport and turns later writes into no-ops.
 */
export class TransportGuard {
	private isRetired = false;

	public constructor(private readonly transport: DestinationStream) {
		const stream = transport as WritableLike;
		stream.on?.("error", (err) => this.retire(err?.message ?? String(err)));
		if (typeof stream.write === "function") {
			const write = stream.write.bind(stream) as Write;
			stream.write = ((chunk: unknown, encodingOrCb?: unknown, cb?: unknown) =>
				this.write(write, chunk, encodingOrCb, cb)) as typeof stream.write;
		}
	}

	/** The guarded transport, for Pino to write to. */
	public get stream(): DestinationStream {
		return this.transport;
	}

	public get retired(): boolean {
		return this.isRetired;
	}

	/** Stops writing: reports `reason` once and destroys the transport. Later calls do nothing. */
	public retire(reason = "retired"): void {
		if (this.isRetired) {
			return;
		}
		this.isRetired = true;
		process.stderr.write(`[scribe-pino] transport retired: ${reason}\n`);
		const stream = this.transport as WritableLike;
		if (typeof stream.destroy !== "function") {
			return;
		}
		try {
			stream.destroy();
		} catch (err) {
			// A transport that fails to destroy is already dead; say so rather than hide it.
			process.stderr.write(`[scribe-pino] transport destroy failed: ${String(err)}\n`);
		}
	}

	private write(write: Write, chunk: unknown, encodingOrCb?: unknown, cb?: unknown): unknown {
		if (this.isRetired) {
			this.complete(encodingOrCb, cb);
			return true;
		}
		try {
			return write(chunk, encodingOrCb, cb);
		} catch (err) {
			this.retire(err instanceof Error ? err.message : String(err));
			this.complete(encodingOrCb, cb);
			return true;
		}
	}

	private complete(encodingOrCb: unknown, cb: unknown): void {
		const done = typeof encodingOrCb === "function" ? encodingOrCb : cb;
		if (typeof done === "function") {
			done();
		}
	}
}
