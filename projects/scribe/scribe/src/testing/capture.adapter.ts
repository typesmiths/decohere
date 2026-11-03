import { LogEntryAdapter } from "../log-entry.adapter.js";
import type { LogEntry } from "../log-entry.js";

/**
 * Test double: keeps every entry that passes the level threshold, prints
 * nothing. `scribe.configure({ adapter: capture })`, run the code, then assert
 * on `capture.entries`.
 */
export class CaptureAdapter extends LogEntryAdapter {
	public readonly entries: LogEntry[] = [];

	/** Entries at `level`. */
	public at(level: string): LogEntry[] {
		return this.entries.filter((entry) => entry.level === level);
	}

	public clear(): void {
		this.entries.length = 0;
	}

	protected write(entry: LogEntry): void {
		this.entries.push(entry);
	}
}
