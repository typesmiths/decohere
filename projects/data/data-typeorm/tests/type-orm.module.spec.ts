import "reflect-metadata";
import {
	type ConnectionInfo,
	DatabaseConfig,
	DEFAULT_DATA_SOURCE,
	TrackingUnitOfWork,
} from "@decohere/data";
import { ServiceContainerBuilder, ResolveError } from "@decohere/crucible";
import { injectable } from "@decohere/crucible/decorators";
import type { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataSourceFactory } from "../src/data-source.factory.js";
import {
	injectDataSource,
	TypeOrmDataSourceToken,
	typeOrmDataSourceToken,
} from "../src/inject-data-source.js";
import { TypeOrmModule } from "../src/type-orm.module.js";

class PositionEntity {}

function pgInfo(overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
	return {
		name: "default",
		provider: "postgres",
		host: "localhost",
		port: 5432,
		database: "app",
		synchronize: false,
		seed: false,
		username: "app",
		password: "secret",
		bootstrap: false,
		...overrides,
	};
}

function fakeDataSource() {
	const repository = { find: vi.fn().mockResolvedValue([]) };
	return {
		initialize: vi.fn().mockResolvedValue(undefined),
		getRepository: vi.fn(() => repository),
		query: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
		createQueryRunner: vi.fn(() => ({
			manager: {},
			isReleased: false,
			release() {},
		})),
		repository,
	};
}

describe("TypeOrmModule DataSource singleton", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("lets a singleton adapter inject DataSource and call getRepository", async () => {
		const ds = fakeDataSource();
		vi.spyOn(DataSourceFactory, "create").mockReturnValue(ds as unknown as DataSource);

		@injectable()
		class TypeOrmPositionBook {
			public constructor(@injectDataSource() private readonly dataSource: DataSource) {}
			public list() {
				return this.dataSource.getRepository(PositionEntity).find();
			}
		}

		const containerBuilder = new ServiceContainerBuilder();
		containerBuilder.registerSingleton(TypeOrmPositionBook);

		const databaseConfig = new DatabaseConfig();
		databaseConfig.dataSources = [pgInfo()];
		await new TypeOrmModule().configure({
			applicationName: "funding-fee.api",
			databaseConfig,
			moduleConfigurations: [{ entities: [PositionEntity] }],
			containerBuilder,
		});

		const container = containerBuilder.build();
		const book = container.resolve(TypeOrmPositionBook);
		await book.list();

		expect(ds.getRepository).toHaveBeenCalledWith(PositionEntity);
		expect(ds.repository.find).toHaveBeenCalled();
		expect(container.resolve(TypeOrmDataSourceToken)).toBe(ds);
		expect(container.resolve(TypeOrmDataSourceToken)).toBe(
			container.resolve(TypeOrmDataSourceToken),
		);
	});

	it("registers a named DataSource without replacing request-scoped UoW", async () => {
		const ds = fakeDataSource();
		vi.spyOn(DataSourceFactory, "create").mockReturnValue(ds as unknown as DataSource);

		@injectable()
		class TypeOrmPositionBook {
			public constructor(@injectDataSource("api") private readonly dataSource: DataSource) {}
			public source() {
				return this.dataSource;
			}
		}

		const containerBuilder = new ServiceContainerBuilder();
		containerBuilder.registerSingleton(TypeOrmPositionBook);

		const databaseConfig = new DatabaseConfig();
		databaseConfig.dataSources = [pgInfo({ name: "api" })];
		await new TypeOrmModule().configure({
			applicationName: "funding-fee.api",
			databaseConfig,
			moduleConfigurations: [{ name: "api", entities: [PositionEntity] }],
			containerBuilder,
		});

		const container = containerBuilder.build();
		expect(container.resolve(TypeOrmPositionBook).source()).toBe(ds);
		expect(container.resolve(typeOrmDataSourceToken("api"))).toBe(ds);
		expect(() => container.resolve(TypeOrmDataSourceToken)).toThrow(ResolveError);

		using scope = container.beginScope("req");
		expect(scope.resolve("api")).toBeInstanceOf(TrackingUnitOfWork);
		expect(() => scope.resolve(DEFAULT_DATA_SOURCE)).toThrow(ResolveError);
	});
});
