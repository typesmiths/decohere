import type { Constructable } from "@decohere/core/reflection";
import type { Entity } from "./data.types.js";

export interface IUnitOfWork {
	commit(): unknown;
	beginTransaction(): Promise<void>;
	/** Roll back anything unfinished and release the connection; prefer this over sync dispose. */
	[Symbol.asyncDispose](): Promise<void>;
	[Symbol.dispose](): void;
}

export interface IDataProvider {
	findById<T extends Entity>(entity: Constructable<T>, key: string | number): Promise<T>;
	save<T>(entity: T): Promise<T>;
	delete<T>(entity: T);
	all<T>(entity: Constructable): Promise<T[]>;
}
