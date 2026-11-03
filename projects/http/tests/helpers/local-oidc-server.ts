/**
 * Minimal in-process OIDC server for integration testing.
 *
 * Uses the `jose` library (already an `@decohere/http` dependency) to generate a real
 * RS256 key pair and serve standard OIDC discovery + JWKS endpoints via a
 * Node.js HTTP server bound to a random port.
 *
 * No external dependencies, no Docker, works in CI.
 *
 * Usage:
 * ```ts
 * const oidc = await LocalOidcServer.start();
 * // configure `@decohere/http` with: discoveryUrl: oidc.issuer
 * const token = await oidc.signToken({ sub: "user-1", scope: "read:Article" });
 * await oidc.stop();
 * ```
 */

import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { CryptoKey } from "jose";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

export class LocalOidcServer {
	private constructor(
		private readonly server: Server,
		private readonly privateKey: CryptoKey,
		private readonly port: number,
	) {}

	public static async start(): Promise<LocalOidcServer> {
		const { privateKey, publicKey } = await generateKeyPair("RS256");
		const publicJwk = {
			...(await exportJWK(publicKey)),
			use: "sig",
			alg: "RS256",
			kid: "test-key-1",
		};

		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

			if (req.url === "/.well-known/openid-configuration") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						issuer,
						jwks_uri: `${issuer}/jwks`,
						authorization_endpoint: `${issuer}/auth`,
						token_endpoint: `${issuer}/token`,
						response_types_supported: ["code"],
						subject_types_supported: ["public"],
						id_token_signing_alg_values_supported: ["RS256"],
					}),
				);
				return;
			}

			if (req.url === "/jwks") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ keys: [publicJwk] }));
				return;
			}

			res.writeHead(404);
			res.end();
		});

		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;

		return new LocalOidcServer(server, privateKey, port);
	}

	public get issuer(): string {
		return `http://127.0.0.1:${this.port}`;
	}

	public async signToken(
		claims: Record<string, unknown> & { aud?: string },
		expiresIn = "1h",
	): Promise<string> {
		const { aud, ...rest } = claims;
		let builder = new SignJWT(rest)
			.setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
			.setIssuedAt()
			.setIssuer(this.issuer)
			.setExpirationTime(expiresIn);
		// Default audience so tests match AuthConfig.audience (required by TokenService).
		builder = builder.setAudience(typeof aud === "string" ? aud : "https://api.test");
		return builder.sign(this.privateKey);
	}

	public stop(): Promise<void> {
		return new Promise((resolve, reject) =>
			this.server.close((err) => (err ? reject(err) : resolve())),
		);
	}
}
