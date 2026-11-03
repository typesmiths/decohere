import { isPromise } from "node:util/types";
import { scribe } from "@decohere/scribe";

/**
 * Trace mode is toggled with FORGE_TRACE, read when a method is decorated. Raising the log level
 * to see the output is the CLI's job at its entry point: importing this module changes nothing.
 */
function isTraceEnabled(): boolean {
	return process.env.FORGE_TRACE != null;
}

type AnyFn = (...args: unknown[]) => unknown;
type TimingLevel = "info" | "trace";

function serializeArgs(args: unknown[]): string {
	if (args.length === 0) return "";
	return args
		.map((arg) => {
			if (Array.isArray(arg)) return `[${arg.map(String).join(", ")}]`;
			const s = String(arg);
			return s.length > 60 ? `${s.slice(0, 57)}...` : s;
		})
		.join(", ");
}

function wrapWithTiming(
	fn: AnyFn,
	className: string,
	methodName: string,
	logLevel: TimingLevel,
): AnyFn {
	let logger: ReturnType<typeof scribe.logger> | undefined;
	return function (this: unknown, ...args: unknown[]) {
		if (logger == null) {
			logger = scribe.logger(className);
		}
		const log = logger;
		const label = `${methodName}(${serializeArgs(args)})`;
		const start = performance.now();
		const logDuration = () => {
			log[logLevel](`${label}: ${(performance.now() - start).toFixed(2)}ms`);
		};
		const result = fn.apply(this, args);
		if (isPromise(result)) {
			return result.finally(logDuration);
		}
		logDuration();
		return result;
	};
}

export function trace(
	target: object,
	propertyKey: string,
	descriptor: PropertyDescriptor,
): PropertyDescriptor {
	if (!isTraceEnabled()) return descriptor;
	const className = (target as { constructor: { name: string } }).constructor.name;
	descriptor.value = wrapWithTiming(
		descriptor.value as AnyFn,
		className,
		propertyKey,
		"trace",
	);
	return descriptor;
}

/**
 * Always-on method timing. Logs duration at `info` regardless of `FORGE_TRACE`.
 * Use this to time a specific method without raising the process log level.
 */
export function timed(
	target: object,
	propertyKey: string,
	descriptor: PropertyDescriptor,
): PropertyDescriptor {
	const className = (target as { constructor: { name: string } }).constructor.name;
	descriptor.value = wrapWithTiming(descriptor.value as AnyFn, className, propertyKey, "info");
	return descriptor;
}

export function Trace(constructor: { name: string; prototype: object }): void {
	if (!isTraceEnabled()) return;
	const className = constructor.name;
	for (const key of Object.getOwnPropertyNames(constructor.prototype)) {
		if (key === "constructor") continue;
		const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, key);
		if (descriptor == null || typeof descriptor.value !== "function") continue;
		descriptor.value = wrapWithTiming(descriptor.value as AnyFn, className, key, "trace");
		Object.defineProperty(constructor.prototype, key, descriptor);
	}
}
