import type { SseMessage } from "./sse.types.js";

/** Line breaks would end a field early, so a client-controlled `id` could inject extra fields. */
function singleLine(value: string): string {
	return value.replace(/[\r\n]+/g, " ");
}

function toMessage(item: unknown): SseMessage {
	if (typeof item === "object" && item !== null && "data" in item) {
		return item as SseMessage;
	}
	return { data: item };
}

/** Encode one event as the text a browser's `EventSource` parses. */
function formatMessage(item: unknown): string {
	const { data, event, id, retry } = toMessage(item);
	let frame = "";
	if (id != null) frame += `id: ${singleLine(String(id))}\n`;
	if (event != null) frame += `event: ${singleLine(event)}\n`;
	if (retry != null && Number.isFinite(retry)) frame += `retry: ${Math.trunc(retry)}\n`;
	const text = typeof data === "string" ? data : (JSON.stringify(data) ?? "");
	for (const line of text.split(/\r\n|\r|\n/)) {
		frame += `data: ${line}\n`;
	}
	return `${frame}\n`;
}

/** A comment line: ignored by `EventSource`, but it is traffic on the wire. */
function formatComment(text: string): string {
	return `: ${singleLine(text)}\n\n`;
}

export const sseWire = { formatMessage, formatComment };
