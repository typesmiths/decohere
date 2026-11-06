import { AppServerToken } from "@decohere/core/hosting";
import type { Metadata } from "./routing/http.types.js";

const RoutingKey = "http:Routing";

export const RouteRegistryToken = Symbol("RouteRegistryToken");
export const HttpProviderToken = AppServerToken;
export const RouterToken = Symbol("RouterToken");
export const PrincipalToken = Symbol("PrincipalToken");
export const IPrincipalProviderToken = Symbol("IPrincipalProvider");
export const TokenServiceToken = Symbol("TokenService");
export const AuthorizationServiceToken = Symbol("AuthorizationService");
export const HttpOptionsToken = Symbol("HttpOptions");
export const ExceptionFilterHostToken = Symbol("ExceptionFilterHost");
export const ReadinessServiceToken = Symbol("ReadinessService");
export type HTTPMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
export const HTTPMethods = {
	GET: "GET",
	PUT: "PUT",
	POST: "POST",
	PATCH: "PATCH",
	DELETE: "DELETE",
} satisfies Record<string, HTTPMethod>;

type AuthMetadata = "authorize" | "allowAnonymous";
type ResponseMetadata = "httpCode" | "headers" | "catch" | "sse";

export const MetadataKeys = {
	controller: `${RoutingKey}:controller`,
	route: `${RoutingKey}:route`,
	parameter: `${RoutingKey}:parameter`,
	fieldMap: `${RoutingKey}:fieldMap`,
	authorize: `${RoutingKey}:authorize`,
	allowAnonymous: `${RoutingKey}:allowAnonymous`,
	httpCode: `${RoutingKey}:httpCode`,
	headers: `${RoutingKey}:headers`,
	catch: `${RoutingKey}:catch`,
	sse: `${RoutingKey}:sse`,
} satisfies Record<Metadata | AuthMetadata | ResponseMetadata, string>;
