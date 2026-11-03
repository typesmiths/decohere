import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenService } from "../src/auth/token-service.js";

// In jwksUrl mode the signing keys were fetched again for every token verified.
// The key set must be created once and reused, so keys are fetched once and then cached.
describe("TokenService with jwksUrl", () => {
	let server: Server | undefined;

	afterEach(async () => {
		vi.unstubAllEnvs();
		await new Promise((resolve) => server?.close(resolve));
		server = undefined;
	});

	it("fetches the key set once across many verifications", async () => {
		vi.stubEnv("NODE_ENV", "test"); // loopback URLs are only allowed in development/test
		const { publicKey, privateKey } = await generateKeyPair("RS256");
		const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
		let fetches = 0;
		server = createServer((_req, res) => {
			fetches++;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ keys: [jwk] }));
		});
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;

		const service = new TokenService({
			jwksUrl: `http://127.0.0.1:${port}/jwks.json`,
			issuer: "test-issuer",
			audience: "test-audience",
		});
		const mint = (sub: string) =>
			new SignJWT({})
				.setProtectedHeader({ alg: "RS256", kid: "k1" })
				.setSubject(sub)
				.setIssuer("test-issuer")
				.setAudience("test-audience")
				.setExpirationTime("5m")
				.sign(privateKey);

		for (let i = 0; i < 5; i++) {
			const principal = await service.verify(await mint(`user-${i}`));
			expect(principal.sub).toBe(`user-${i}`);
		}

		expect(fetches).toBe(1);
	});
});
