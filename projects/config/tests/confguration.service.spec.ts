import { ServiceContainerBuilder } from "@decohere/crucible";
import { injectable } from "@decohere/crucible/decorators";
import { ConfigurationServiceToken } from "@decohere/core/configuration";
import { describe, expect, it, vi } from "vitest";
import {
	ConfigurationDataSource,
	ConfigurationDataSourceKey,
	ConfigurationService,
} from "../src/index.js";

describe("ConfigurationService", () => {
	describe("lazy initialization", () => {
		const mockData1 = { field1: "fieldData" };
		const mockData2 = { field2: "fieldData" };

		class MockDataSource1 extends ConfigurationDataSource {
			public name: string = "";
			public async getData(): Promise<Record<string, unknown>> {
				return mockData1;
			}
		}

		class MockDataSource2 extends ConfigurationDataSource {
			public name: string = "";
			public async getData(): Promise<Record<string, unknown>> {
				return mockData2;
			}
		}

		it("should initialize data sources when get() is called", async () => {
			const dataSource1 = new MockDataSource1();
			const dataSource2 = new MockDataSource2();
			const getData1 = vi.spyOn(dataSource1, "getData");
			const getData2 = vi.spyOn(dataSource2, "getData");
			const configService = new ConfigurationService([dataSource1, dataSource2]);
			await configService.get("field1");
			expect(getData1).toHaveBeenCalled();
			expect(getData2).toHaveBeenCalled();
		});

		it("should throw if duplicate named datasources exist when get() is called", async () => {
			const dataSource1 = new MockDataSource1();
			const dataSource2 = new MockDataSource1();
			const configService = new ConfigurationService([dataSource1, dataSource2]);
			const getCall = () => configService.get("field1");
			await expect(getCall).rejects.toThrow(
				"Cannot have duplicate data source names. The data sources are: field1,field1",
			);
		});
	});

	describe("get", () => {
		class CustomObjectConfig {}
		const customObject = { value: "value" };
		class MockDataSource1 extends ConfigurationDataSource {
			public name: string = "";
			public async getData(): Promise<Record<string, unknown>> {
				return {
					stringKey: "value",
					customObject,
				};
			}
		}

		it("should get data from ds with a string key", async () => {
			const configurationService = new ConfigurationService([new MockDataSource1()]);

			const data = await configurationService.get("stringKey");
			expect(data).toEqual("value");
		});

		it("should get data from type key", async () => {
			const configurationService = new ConfigurationService([new MockDataSource1()]);

			const data = await configurationService.get(CustomObjectConfig);
			expect(data).toEqual(customObject);
		});
	});

	describe("injectable", () => {
		const mockData = { field1: "fieldData" };

		@injectable()
		class MockDataSource extends ConfigurationDataSource {
			public name: string = "";
			public async getData(): Promise<Record<string, unknown>> {
				return mockData;
			}
		}
		it("should support injecting data source", async () => {
			const containerBuiler = new ServiceContainerBuilder();
			containerBuiler.registerSingleton(ConfigurationServiceToken, ConfigurationService);
			containerBuiler.registerSingleton(ConfigurationDataSourceKey, MockDataSource);
			const container = containerBuiler.build();
			const configService = (await container.resolve(
				ConfigurationServiceToken,
			)) as ConfigurationService;
			expect(configService.dataSources.at(0)).toBeInstanceOf(MockDataSource);
		});
	});
});
