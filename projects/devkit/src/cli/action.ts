import type { Constructable } from "@decohere/core/reflection";
import type { UnionToIntersection } from "@decohere/core/system";

export const ActionMap = Symbol("ActionMap");

export type ActionClassMap = Record<string, Constructable<Action>>;

export interface ResultStatus {
	succeeded: boolean;
	error?: string;
}

export interface Result {
	readonly name: string;
	readonly succeeded: boolean;
	readonly skipped: boolean;
	readonly message: string;
}

export class ActionResponse<TData = unknown> implements Result {
	public static Success<TData>(name: string, data?: TData[]) {
		return new ActionResponse<TData>({ name, data, succeeded: true });
	}

	public static Skipped(name: string) {
		return new ActionResponse({ name, skipped: true });
	}

	public static Blocking(name: string) {
		return new ActionResponse({ name, succeeded: true, blocking: true });
	}

	public static Error<TData = unknown>(name: string, message: string): ActionResponse<TData>;
	public static Error<TData extends ResultStatus>(
		name: string,
		data: TData[],
	): ActionResponse<TData>;
	public static Error<TData extends ResultStatus>(
		name: string,
		messageOrData: string | TData[],
		data?: TData[],
	) {
		if (Array.isArray(messageOrData)) {
			const message = messageOrData
				.filter((r) => !r.succeeded)
				.map((r) => r.error ?? "Unknown error")
				.join("\n");
			return new ActionResponse<TData>({ name, message, data: messageOrData });
		}
		return new ActionResponse<TData>({ name, message: messageOrData, data });
	}

	public constructor(data: Partial<ActionResponse<TData>>) {
		Object.assign(this, data);
	}

	public readonly name: string;
	public readonly succeeded: boolean = false;
	public readonly skipped: boolean = false;
	public readonly blocking: boolean = false;
	public readonly message: string;
	public readonly data: TData[];
}

export interface Action<T extends object = object> {
	run(options: T): Promise<ActionResponse>;
}

export type Actions = Record<string, Action>;

export type ActionOptions<A extends Action> = A extends Action<infer T> ? T : never;

export type MergeOptions<TActions extends Record<string, Action>> = UnionToIntersection<
	{
		[K in keyof TActions]: ActionOptions<TActions[K]>;
	}[keyof TActions]
>;
