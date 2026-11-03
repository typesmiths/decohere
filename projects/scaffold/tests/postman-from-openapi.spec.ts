import { describe, expect, it } from "vitest";
import {
	buildHybridPostmanCollection,
	POSTMAN_CALLBACKS,
	POSTMAN_SCOPES,
} from "../src/webapi/features/postman.feature.js";
import { buildHelloOpenApiDocument } from "../src/webapi/postman/hello-openapi.js";
import {
	buildEnvironmentYaml,
	buildLocalViewFilesFromCollection,
} from "../src/webapi/postman/local-view.js";
import {
	applyPostmanAuthOverlay,
	openApiPathParamsToColon,
	openApiToPostmanCollection,
	type PostmanCollection,
} from "../src/webapi/postman/openapi-to-postman.js";

const auth0 = {
	auth0Domain: "example.auth0.com",
	auth0Audience: "https://api.example.com",
	auth0ClientId: "abc",
};

describe("Postman from OpenAPI (hybrid)", () => {
	it("converts Hello OpenAPI into a Postman collection with :id paths", async () => {
		const openapi = buildHelloOpenApiDocument("Demo");
		const base = await openApiToPostmanCollection(openapi);
		const collection = applyPostmanAuthOverlay(base, "Demo", undefined, {
			callbacks: POSTMAN_CALLBACKS,
			scopes: POSTMAN_SCOPES,
			description: "test",
		});

		expect(collection.info.name).toBe("Demo WebAPI");
		const helloFolder = collection.item?.find((i) => i.name === "Hello");
		expect(helloFolder?.item?.length).toBeGreaterThanOrEqual(5);

		const urls = (helloFolder?.item ?? [])
			.map((i) => {
				const url = i.request?.url;
				return typeof url === "string" ? url : url?.raw;
			})
			.filter(Boolean);

		expect(urls).toEqual(
			expect.arrayContaining(["{{baseUrl}}/hello", "{{baseUrl}}/hello/:id"]),
		);

		const list = helloFolder?.item?.find((i) => i.name === "List (anonymous)");
		expect(list?.request?.auth).toEqual({ type: "noauth" });
	});

	it("applies Auth0 overlay without changing route inventory", async () => {
		const collection = await buildHybridPostmanCollection("Demo", auth0);
		expect(collection.auth).toMatchObject({ type: "oauth2" });
		const hello = collection.item?.find((i) => i.name === "Hello");
		expect(hello?.item?.some((i) => i.name === "Create")).toBe(true);
	});

	it("emits Local View YAML requests from the hybrid collection", async () => {
		const collection = await buildHybridPostmanCollection("Demo");
		const files = buildLocalViewFilesFromCollection(collection, "Demo", undefined, {
			callbacks: POSTMAN_CALLBACKS,
			scopes: POSTMAN_SCOPES,
		});
		const paths = files.map((f) => f.filePath);
		expect(paths).toContain("postman/collections/Demo WebAPI/.resources/definition.yaml");
		expect(paths.some((p) => p.includes("List (anonymous).request.yaml"))).toBe(true);
		expect(paths.some((p) => p.includes("Create.request.yaml"))).toBe(true);

		const create = files.find((f) => f.filePath.endsWith("Create.request.yaml"));
		expect(create?.content).toContain('url: "{{baseUrl}}/hello"');
		expect(create?.content).toContain("method: POST");
	});

	it("builds environment YAML with and without Auth0", () => {
		const bare = buildEnvironmentYaml("Demo Local", undefined, {
			callbacks: POSTMAN_CALLBACKS,
			scopes: POSTMAN_SCOPES,
		});
		expect(bare).toContain("name: Demo Local");
		expect(bare).toContain("key: baseUrl");
		expect(bare).not.toContain("auth0Domain");

		const withAuth = buildEnvironmentYaml("Demo Local", auth0, {
			callbacks: POSTMAN_CALLBACKS,
			scopes: POSTMAN_SCOPES,
		});
		expect(withAuth).toContain("key: auth0Domain");
		expect(withAuth).toContain("value: example.auth0.com");
		expect(withAuth).toContain("key: callbackUrl");
	});

	it("emits Local View collection auth block and request edge cases", async () => {
		const collection = await buildHybridPostmanCollection("Demo", auth0);
		const files = buildLocalViewFilesFromCollection(collection, "Demo", auth0, {
			callbacks: POSTMAN_CALLBACKS,
			scopes: POSTMAN_SCOPES,
		});
		const definition = files.find((f) =>
			f.filePath.endsWith(".resources/definition.yaml"),
		)?.content;
		expect(definition).toContain("auth:");
		expect(definition).toContain("type: oauth2");

		const list = files.find((f) => f.filePath.endsWith("List (anonymous).request.yaml"));
		expect(list?.content).toContain("auth:");
		expect(list?.content).toContain("type: noauth");

		const create = files.find((f) => f.filePath.endsWith("Create.request.yaml"));
		expect(create?.content).toContain("body:");
		expect(create?.content).toContain("type: json");
	});

	it("rewrites OpenAPI path params without touching Postman variables", () => {
		expect(openApiPathParamsToColon("{{baseUrl}}/hello/{id}")).toBe("{{baseUrl}}/hello/:id");
		expect(openApiPathParamsToColon("/hello")).toBe("/hello");
		expect(openApiPathParamsToColon("hello")).toBe("hello");
	});

	it("uses default collection schema when converter omits info.schema", async () => {
		const base = await openApiToPostmanCollection(buildHelloOpenApiDocument("Demo"));
		const withoutSchema: PostmanCollection = {
			...base,
			info: { ...base.info, schema: undefined as unknown as string },
		};
		const collection = applyPostmanAuthOverlay(withoutSchema, "Demo", auth0, {
			callbacks: POSTMAN_CALLBACKS,
			scopes: POSTMAN_SCOPES,
			description: "test",
		});
		expect(collection.info.schema).toBe(
			"https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
		);
	});

	it("handles nested folders and non-request items in overlay rewrite", () => {
		const collection: PostmanCollection = {
			info: {
				name: "stub",
				schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
			},
			item: [
				{ name: "Docs" },
				{
					name: "Hello",
					item: [
						{
							name: "Get one",
							request: {
								method: "GET",
								url: { host: ["{{baseUrl}}"], path: ["hello", "{id}"] },
							},
						},
						{
							name: "Create",
							request: {
								method: "POST",
								url: "hello",
								header: [{ key: "Content-Type", value: "application/json" }],
								body: { raw: '{"message":"x"}' },
							},
						},
					],
				},
			],
		};
		const next = applyPostmanAuthOverlay(collection, "Demo", undefined, {
			callbacks: POSTMAN_CALLBACKS,
			scopes: POSTMAN_SCOPES,
			description: "test",
		});
		const hello = next.item?.find((i) => i.name === "Hello");
		const getOne = hello?.item?.find((i) => i.name === "Get one");
		const create = hello?.item?.find((i) => i.name === "Create");
		expect(getOne?.request?.url).toMatchObject({ raw: "{{baseUrl}}/hello/:id" });
		expect(create?.request?.url).toMatchObject({ raw: "{{baseUrl}}/hello" });
		expect(next.item?.find((i) => i.name === "Docs")).toEqual({ name: "Docs" });
	});

	it("rejects invalid OpenAPI documents at conversion time", async () => {
		await expect(
			openApiToPostmanCollection({ foo: "bar" } as unknown as ReturnType<
				typeof buildHelloOpenApiDocument
			>),
		).rejects.toThrow(/semantic version|conversion failed/i);
	});

	it("quotes YAML values that need escaping", () => {
		const yaml = buildEnvironmentYaml('Demo: Local "env"', auth0, {
			callbacks: POSTMAN_CALLBACKS,
			scopes: POSTMAN_SCOPES,
		});
		expect(yaml).toContain('"Demo: Local \\"env\\""');
	});
});
