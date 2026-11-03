/** Minimal OpenAPI 3 document shape used for Postman conversion. */
export type ScaffoldOpenApiDocument = {
	openapi: "3.0.3";
	info: { title: string; version: string; description?: string };
	servers?: Array<{ url: string; description?: string }>;
	paths: Record<string, Record<string, unknown>>;
};

/**
 * Canonical Hello WebAPI OpenAPI document used to generate Postman requests.
 * Keep paths aligned with scaffolded HelloController (`/hello`, `/hello/{id}`).
 */
export function buildHelloOpenApiDocument(projectName: string): ScaffoldOpenApiDocument {
	return {
		openapi: "3.0.3",
		info: {
			title: `${projectName} WebAPI`,
			version: "1.0.0",
			description:
				"Generated from OpenAPI for Postman. Auth/env overlays are applied separately.",
		},
		servers: [{ url: "{{baseUrl}}" }],
		paths: {
			"/hello": {
				get: {
					operationId: "HelloController.getAll",
					summary: "List (anonymous)",
					tags: ["Hello"],
					parameters: [
						{ name: "filter", in: "query", required: false, schema: { type: "string" } },
					],
					responses: { "200": { description: "Successful response" } },
				},
				post: {
					operationId: "HelloController.create",
					summary: "Create",
					tags: ["Hello"],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: { message: { type: "string" } },
									required: ["message"],
									example: { message: "hello" },
								},
							},
						},
					},
					responses: { "200": { description: "Successful response" } },
				},
			},
			"/hello/{id}": {
				get: {
					operationId: "HelloController.getOne",
					summary: "Get by id",
					tags: ["Hello"],
					parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
					responses: { "200": { description: "Successful response" } },
				},
				put: {
					operationId: "HelloController.update",
					summary: "Update",
					tags: ["Hello"],
					parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: { message: { type: "string" } },
									required: ["message"],
									example: { message: "updated" },
								},
							},
						},
					},
					responses: { "200": { description: "Successful response" } },
				},
				delete: {
					operationId: "HelloController.remove",
					summary: "Delete",
					tags: ["Hello"],
					parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
					responses: { "200": { description: "Successful response" } },
				},
			},
		},
	};
}
