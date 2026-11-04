import { describe, expect, it } from "vitest";
import {
	ADMIN_ROLE,
	createPrincipalFromPayload,
	defineAbilitiesFor,
} from "../src/auth/ability.js";
import { CaslAuthorizationService } from "../src/auth/casl-authorization.service.js";
import { ForbiddenError } from "../src/routing/http.types.js";

describe("defineAbilitiesFor", () => {
	it("grants manage/all for the admin role", async () => {
		const svc = new CaslAuthorizationService(defineAbilitiesFor);
		await expect(
			svc.authorize({ sub: "a", roles: [ADMIN_ROLE] }, "delete", "Hello"),
		).resolves.toBeUndefined();
		await expect(
			svc.authorize({ sub: "a", roles: [ADMIN_ROLE] }, "create", "Invoice"),
		).resolves.toBeUndefined();
	});

	it("maps action:Subject scopes for non-admin principals", async () => {
		const svc = new CaslAuthorizationService(defineAbilitiesFor);
		const user = { sub: "u", scopes: ["read:Hello", "create:Hello"] };
		await expect(svc.authorize(user, "read", "Hello")).resolves.toBeUndefined();
		await expect(svc.authorize(user, "create", "Hello")).resolves.toBeUndefined();
		await expect(svc.authorize(user, "delete", "Hello")).rejects.toThrow(ForbiddenError);
	});
});

describe("createPrincipalFromPayload", () => {
	it("merges scope string and permissions claim", () => {
		const principal = createPrincipalFromPayload({
			sub: "auth0|user",
			scope: "read:Hello openid",
			permissions: ["create:Hello", "read:Hello"],
			roles: ["viewer"],
		});
		expect(principal.sub).toBe("auth0|user");
		expect(principal.roles).toEqual(["viewer"]);
		expect(principal.scopes?.sort()).toEqual(["create:Hello", "openid", "read:Hello"].sort());
	});

	it("returns undefined roles/scopes when absent", () => {
		const principal = createPrincipalFromPayload({ sub: "x" });
		expect(principal.roles).toBeUndefined();
		expect(principal.scopes).toBeUndefined();
	});
});
