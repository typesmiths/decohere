import type { IUnitOfWork } from "@decohere/data";
import type { Constructable } from "@decohere/core/reflection";
import type { DataSource, QueryRunner, Repository } from "typeorm";

export class TypeOrmUnitOfWork implements IUnitOfWork {
	private readonly dataSource: DataSource;
	public readonly queryRunner: QueryRunner;

	public constructor(dataSource: DataSource) {
		this.dataSource = dataSource;
		this.queryRunner = this.dataSource.createQueryRunner();
	}

	public get entityManager() {
		return this.queryRunner.manager;
	}

	public getRepository<T>(entity: Constructable): Repository<T> {
		return this.entityManager.getRepository<T>(entity);
	}

	public async beginTransaction(): Promise<void> {
		return this.queryRunner.startTransaction();
	}

	public async commit() {
		return this.queryRunner.commitTransaction();
	}

	/**
	 * Hand the connection back to the pool, rolling back first if a transaction is still open
	 * (e.g. the request failed before commit). Otherwise the next user of that pooled
	 * connection would inherit the half-finished transaction.
	 */
	public async [Symbol.asyncDispose]() {
		if (this.queryRunner.isReleased) {
			return;
		}
		try {
			if (this.queryRunner.isTransactionActive) {
				await this.queryRunner.rollbackTransaction();
			}
		} finally {
			await this.queryRunner.release();
		}
	}

	/** Prefer `await using` / async disposal; this starts the same cleanup without waiting. */
	public [Symbol.dispose]() {
		void this[Symbol.asyncDispose]();
	}
}
