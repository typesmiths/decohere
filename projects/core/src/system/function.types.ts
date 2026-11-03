/**
 * Generic function type that can replace arrow function signatures.
 *
 * @example
 * ```typescript
 * // Instead of: (arg1: string, arg2: number) => boolean
 * type MyCallback = Func<[string, number], boolean>;
 *
 * // Instead of: (data: any) => void
 * type MyHandler = Func<[any], void>;
 *
 * // Instead of: () => Promise<string>
 * type MyAsyncFunc = Func<[], Promise<string>>;
 * ```
 */
export type Func<TArgs extends readonly unknown[] = [], TReturn = void> = (
	...args: TArgs
) => TReturn;

/**
 * Async function type that returns a Promise.
 *
 * @example
 * ```typescript
 * // Instead of: (id: string) => Promise<User>
 * type GetUser = AsyncFunc<[string], User>;
 *
 * // Instead of: () => Promise<void>
 * type InitFunc = AsyncFunc<[], void>;
 * ```
 */
export type AsyncFunc<TArgs extends readonly unknown[] = [], TReturn = void> = Func<
	TArgs,
	Promise<TReturn>
>;

/**
 * Predicate function type that returns a boolean.
 *
 * @example
 * ```typescript
 * // Instead of: (item: T) => boolean
 * type Filter<T> = Predicate<[T]>;
 *
 * // Instead of: (a: number, b: number) => boolean
 * type Comparator = Predicate<[number, number]>;
 * ```
 */
export type Predicate<TArgs extends readonly unknown[] = []> = Func<TArgs, boolean>;

/**
 * Action function type that returns void.
 *
 * @example
 * ```typescript
 * // Instead of: (event: Event) => void
 * type EventHandler = Action<[Event]>;
 *
 * // Instead of: () => void
 * type Callback = Action<[]>;
 * ```
 */
export type Action<TArgs extends readonly unknown[] = []> = Func<TArgs, void>;
