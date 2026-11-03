import { randomUUID } from "node:crypto";

/** Canonical inbound/outbound request id header (lowercase). */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Prefer an inbound `x-request-id`, then an existing id, otherwise generate one.
 */
export function resolveRequestId(headers: Record<string, string>, fallback?: string): string {
	const fromHeader = headers[REQUEST_ID_HEADER]?.trim();
	if (fromHeader) {
		return fromHeader;
	}
	if (fallback?.trim()) {
		return fallback.trim();
	}
	return randomUUID();
}
