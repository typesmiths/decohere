import { vi } from "vitest";

export type LoggerMethod = (msg: string | number | object, ...args: unknown[]) => void;

export type TestLogger = {
	fatal: LoggerMethod;
	error: LoggerMethod;
	warn: LoggerMethod;
	info: LoggerMethod;
	debug: LoggerMethod;
	trace: LoggerMethod;
	isLevelEnabled(level: string): boolean;
	child(fields: Record<string, unknown>): TestLogger;
	readonly currentLevel: string;
	readonly logLevels: Record<string, number>;
};

const DefaultLogLevels: Record<string, number> = {
	fatal: 60,
	error: 50,
	warn: 40,
	info: 30,
	debug: 20,
	trace: 10,
};

/** `child` returns the same mock, so calls on a child are asserted on the parent. */
export function createMockLogger(): TestLogger {
	const logger: TestLogger = {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
		fatal: vi.fn(),
		isLevelEnabled: vi.fn().mockReturnValue(true),
		child: vi.fn(() => logger),
		get currentLevel() {
			return "info";
		},
		get logLevels() {
			return DefaultLogLevels;
		},
	};
	return logger;
}
