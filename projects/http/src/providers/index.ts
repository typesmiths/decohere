// FastifyProvider lives in @decohere/http-fastify. This re-export, and bootModule's default
// provider, stay only until the scaffolder's web API recipe imports it from there. Removing both
// is what takes Fastify out of @decohere/http's install.
export { FastifyProvider } from "@decohere/http-fastify";
