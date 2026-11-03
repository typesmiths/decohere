export type OpenApiInfo = {
	title: string;
	version: string;
	description?: string;
};

export type OpenApiServer = {
	url: string;
	description?: string;
};

export type OpenApiOptions = {
	/** Defaults to `/openapi.json`. Absolute Fastify path (not affected by globalPrefix). */
	path?: string;
	info: OpenApiInfo;
	servers?: OpenApiServer[];
	/** When true (default), validate request params/query/body before the handler. */
	validateRequests?: boolean;
};

export type JsonSchema = {
	type?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
	additionalProperties?: boolean | JsonSchema;
	format?: string;
	description?: string;
	minLength?: number;
	maxLength?: number;
};

export type OpenApiParameter = {
	name: string;
	in: "query" | "path" | "header" | "cookie";
	required?: boolean;
	schema?: JsonSchema;
};

export type OpenApiOperation = {
	operationId?: string;
	summary?: string;
	tags?: string[];
	parameters?: OpenApiParameter[];
	requestBody?: {
		required?: boolean;
		content: Record<string, { schema: JsonSchema }>;
	};
	responses: Record<
		string,
		{ description: string; content?: Record<string, { schema: JsonSchema }> }
	>;
};

export type OpenApiDocument = {
	openapi: "3.0.3";
	info: OpenApiInfo;
	servers?: OpenApiServer[];
	paths: Record<string, Partial<Record<string, OpenApiOperation>>>;
};
