export type ReceivedEvent = {
	/** The `data:` lines joined with `\n`, as `EventSource` would give them. */
	data: string;
	event?: string;
	id?: string;
	retry?: number;
};

export type EventStreamRead = {
	status: number;
	headers: Headers;
	/** The events received, at most the requested count. */
	events: ReceivedEvent[];
	/** Comment lines (`: heartbeat` and the like) seen before the read ended. */
	comments: string[];
	/** True when the server ended the stream (as opposed to the reader stopping at the count). */
	ended: boolean;
};

export type ReadEventsOptions = {
	/** Stop and close the connection after this many events. Default 1. `Infinity` reads until the server ends the stream. */
	count?: number;
	headers?: Record<string, string>;
	/** Give up (and fail) if the read has not finished after this many milliseconds. Default 5000. */
	timeoutMs?: number;
};

/** Incremental parser for the `text/event-stream` format. */
class SseParser {
	private buffer = "";
	private data: string[] = [];
	private current: ReceivedEvent = { data: "" };
	private hasFields = false;

	public readonly events: ReceivedEvent[] = [];
	public readonly comments: string[] = [];

	public push(chunk: string): void {
		this.buffer += chunk;
		let newline: number;
		while ((newline = this.buffer.search(/\r\n|\r|\n/)) !== -1) {
			const line = this.buffer.slice(0, newline);
			const eol = this.buffer.slice(newline).startsWith("\r\n") ? 2 : 1;
			this.buffer = this.buffer.slice(newline + eol);
			this.line(line);
		}
	}

	private line(line: string): void {
		if (line === "") {
			if (this.hasFields) {
				this.events.push({ ...this.current, data: this.data.join("\n") });
			}
			this.data = [];
			this.current = { data: "" };
			this.hasFields = false;
			return;
		}
		if (line.startsWith(":")) {
			this.comments.push(line.slice(1).trim());
			return;
		}
		const colon = line.indexOf(":");
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? "" : line.slice(colon + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		this.hasFields = true;
		if (field === "data") this.data.push(value);
		else if (field === "event") this.current.event = value;
		else if (field === "id") this.current.id = value;
		else if (field === "retry") this.current.retry = Number(value);
	}
}

/**
 * GET `url` as an `EventSource` would and collect events until `count` have arrived or the
 * server ends the stream. A non-200 answer (401, 403, ...) returns at once with no events.
 */
export async function readEventStream(
	url: string,
	options: ReadEventsOptions = {},
): Promise<EventStreamRead> {
	const count = options.count ?? 1;
	const abort = new AbortController();
	const timer = setTimeout(
		() => abort.abort(new Error(`No ${count} events from ${url} in time`)),
		options.timeoutMs ?? 5000,
	);
	try {
		const response = await fetch(url, {
			headers: { accept: "text/event-stream", ...options.headers },
			signal: abort.signal,
		});
		const parser = new SseParser();
		let ended = false;
		if (response.status === 200 && response.body != null) {
			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
			while (parser.events.length < count) {
				const { done, value } = await reader.read();
				if (done) {
					ended = true;
					break;
				}
				parser.push(value);
			}
			await reader.cancel();
		} else {
			await response.body?.cancel();
		}
		return {
			status: response.status,
			headers: response.headers,
			events: parser.events.slice(0, count),
			comments: parser.comments,
			ended,
		};
	} finally {
		clearTimeout(timer);
	}
}
