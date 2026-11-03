import { exportJWK, exportSPKI, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenService } from "../src/auth/token-service.js";
import { UnauthorizedError } from "../src/routing/anvil.types.js";

async function mintToken(
	privateKey: Parameters<typeof SignJWT.prototype.sign>[0],
	payload: Record<string, unknown> = {},
	options: { exp?: string; iss?: string; aud?: string; alg?: string } = {},
) {
	return new SignJWT(payload)
		.setProtectedHeader({ alg: options.alg ?? "RS256" })
		.setIssuedAt()
		.setSubject((payload.sub as string) ?? "user-1")
		.setIssuer(options.iss ?? "test-issuer")
		.setAudience(options.aud ?? "test-audience")
		.setExpirationTime(options.exp ?? "5m")
		.sign(privateKey);
}

describe("TokenService", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});
	describe("RS256 with public key (PEM)", () => {
		it("verifies a valid token and returns the principal", async () => {
			const { publicKey, privateKey } = await generateKeyPair("RS256");
			const pem = await exportSPKI(publicKey);
			const service = new TokenService({
				publicKey: pem,
				algorithms: ["RS256"],
				issuer: "test-issuer",
				audience: "test-audience",
			});

			const token = await mintToken(privateKey, { roles: ["admin"] });
			const principal = await service.verify(token);

			expect(principal.sub).toBe("user-1");
			expect(principal.roles).toContain("admin");
		});

		it("throws UnauthorizedError for an expired token", async () => {
			const { publicKey, privateKey } = await generateKeyPair("RS256");
			const pem = await exportSPKI(publicKey);
			const service = new TokenService({
				publicKey: pem,
				issuer: "test-issuer",
				audience: "test-audience",
			});

			const token = await mintToken(privateKey, {}, { exp: "1s" });
			// Wait for token to expire (jose v6 has 1-second resolution)
			await new Promise((r) => setTimeout(r, 1100));

			await expect(service.verify(token)).rejects.toThrow(UnauthorizedError);
		});

		it("throws UnauthorizedError for wrong issuer", async () => {
			const { publicKey, privateKey } = await generateKeyPair("RS256");
			const pem = await exportSPKI(publicKey);
			const service = new TokenService({
				publicKey: pem,
				issuer: "expected-issuer",
				audience: "test-audience",
			});

			const token = await mintToken(privateKey, {}, { iss: "wrong-issuer" });
			await expect(service.verify(token)).rejects.toThrow(UnauthorizedError);
		});

		it("throws UnauthorizedError for wrong audience", async () => {
			const { publicKey, privateKey } = await generateKeyPair("RS256");
			const pem = await exportSPKI(publicKey);
			const service = new TokenService({
				publicKey: pem,
				issuer: "test-issuer",
				audience: "expected-audience",
			});

			const token = await mintToken(privateKey, {}, { aud: "wrong-audience" });
			await expect(service.verify(token)).rejects.toThrow(UnauthorizedError);
		});

		it("does not accept a foreign-audience token when configured audience is empty", async () => {
			const { publicKey, privateKey } = await generateKeyPair("RS256");
			const pem = await exportSPKI(publicKey);
			// Empty audience must fail closed — jose skips `aud` checks when audience is ""/undefined.
			expect(
				() =>
					new TokenService({
						publicKey: pem,
						issuer: "test-issuer",
						audience: "",
					}),
			).toThrow(/audience must be a non-empty string/);

			const service = new TokenService({
				publicKey: pem,
				issuer: "test-issuer",
				audience: "https://api.webapi",
			});
			const token = await mintToken(
				privateKey,
				{ scope: "create:Hello" },
				{ aud: "https://api.other" },
			);
			await expect(service.verify(token)).rejects.toThrow(UnauthorizedError);
		});

		it("throws UnauthorizedError when signed with a different key", async () => {
			const { publicKey } = await generateKeyPair("RS256");
			const { privateKey: otherPrivate } = await generateKeyPair("RS256");
			const pem = await exportSPKI(publicKey);
			const service = new TokenService({
				publicKey: pem,
				issuer: "test-issuer",
				audience: "test-audience",
			});

			const token = await mintToken(otherPrivate, {}, {});
			await expect(service.verify(token)).rejects.toThrow(UnauthorizedError);
		});

		it("throws UnauthorizedError for a malformed token string", async () => {
			const { publicKey } = await generateKeyPair("RS256");
			const pem = await exportSPKI(publicKey);
			const service = new TokenService({
				publicKey: pem,
				issuer: "test-issuer",
				audience: "test-audience",
			});

			await expect(service.verify("not.a.jwt")).rejects.toThrow(UnauthorizedError);
		});
	});

	describe("RS256 with public key (JWK JSON)", () => {
		it("verifies a valid token using a JWK public key", async () => {
			const { publicKey, privateKey } = await generateKeyPair("RS256");
			const jwkObj = await exportJWK(publicKey);
			// JWK must include alg for importJWK without explicit algorithm arg
			jwkObj.alg = "RS256";
			const jwk = JSON.stringify(jwkObj);
			const service = new TokenService({
				publicKey: jwk,
				algorithms: ["RS256"],
				issuer: "test-issuer",
				audience: "test-audience",
			});

			const token = await mintToken(privateKey);
			const principal = await service.verify(token);
			expect(principal.sub).toBe("user-1");
		});
	});

	describe("HS256 with shared secret", () => {
		const secret = "super-secret-key-that-is-long-enough-for-hs256";

		it("verifies a HS256 token signed with the same secret", async () => {
			const service = new TokenService({
				secret,
				issuer: "test-issuer",
				audience: "test-audience",
			});
			const token = await service.sign({ sub: "alice", roles: ["reader"] });
			const principal = await service.verify(token);

			expect(principal.sub).toBe("alice");
			expect(principal.roles).toContain("reader");
		});

		it("throws UnauthorizedError when secret does not match", async () => {
			const signer = new TokenService({ secret, issuer: "x", audience: "y" });
			const verifier = new TokenService({
				secret: "different-secret-at-least-32-chars-long",
				issuer: "x",
				audience: "y",
			});

			const token = await signer.sign({ sub: "bob" });
			await expect(verifier.verify(token)).rejects.toThrow(UnauthorizedError);
		});

		it("sign() throws when not using SecretConfig", async () => {
			const { publicKey } = await generateKeyPair("RS256");
			const pem = await exportSPKI(publicKey);
			const service = new TokenService({
				publicKey: pem,
				issuer: "test-issuer",
				audience: "test-audience",
			});

			await expect(service.sign({ sub: "x" })).rejects.toThrow("SecretConfig");
		});
	});

	describe("devStatic mode", () => {
		it("returns the static principal for any token in development", async () => {
			vi.stubEnv("NODE_ENV", "development");
			const service = new TokenService({
				devStatic: { sub: "dev-user", roles: ["admin"] },
			});

			const principal = await service.verify("any-token-at-all");
			expect(principal.sub).toBe("dev-user");
			expect(principal.roles).toContain("admin");
		});

		it("rejects constructing TokenService with devStatic when NODE_ENV is production", () => {
			vi.stubEnv("NODE_ENV", "production");
			expect(
				() =>
					new TokenService({
						devStatic: { sub: "dev-user", roles: ["admin"] },
					}),
			).toThrow(/devStatic.*NODE_ENV/);
		});
	});

	describe("scope claim parsing", () => {
		it("splits a space-separated scope string into scopes array", async () => {
			const { publicKey, privateKey } = await generateKeyPair("RS256");
			const pem = await exportSPKI(publicKey);
			const service = new TokenService({
				publicKey: pem,
				issuer: "test-issuer",
				audience: "test-audience",
			});

			const token = await mintToken(privateKey, { scope: "read write" });
			const principal = await service.verify(token);
			expect(principal.scopes).toEqual(["read", "write"]);
		});

		it("uses a scopes array claim directly", async () => {
			const { publicKey, privateKey } = await generateKeyPair("RS256");
			const pem = await exportSPKI(publicKey);
			const service = new TokenService({
				publicKey: pem,
				issuer: "test-issuer",
				audience: "test-audience",
			});

			const token = await mintToken(privateKey, { scopes: ["read", "admin"] });
			const principal = await service.verify(token);
			expect(principal.scopes).toEqual(["read", "admin"]);
		});
	});
});
