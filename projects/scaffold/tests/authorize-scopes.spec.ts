import { mkdirSync, writeFileSync } from "node:fs";
import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	discoverAuthorizeScopes,
	mergeApiScopes,
	postmanRequestedScopes,
} from "../src/webapi/authorize-scopes.js";

beforeEach(() => {
	resetMemfs();
	mkdirSync("/app/projects/api/src/controllers", { recursive: true });
	writeFileSync("/app/package.json", JSON.stringify({ scripts: { build: "forge build" } }));
	writeFileSync("/app/projects/api/package.json", JSON.stringify({ name: "api" }));
});

afterEach(() => {
	resetMemfs();
});

describe("discoverAuthorizeScopes", () => {
	it("collects action:Subject from class and method @Authorize", () => {
		writeFileSync(
			"/app/projects/api/src/controllers/invoice.controller.ts",
			[
				'@Authorize("read", "Invoice")',
				"export class InvoiceController {",
				'	@Authorize("create", "Invoice")',
				"	public create() {}",
				'	@Authorize("delete", "Invoice")',
				"	public remove() {}",
				"}",
				"",
			].join("\n"),
		);

		expect(discoverAuthorizeScopes("/app")).toEqual([
			"create:Invoice",
			"delete:Invoice",
			"read:Invoice",
		]);
	});

	it("defaults a missing subject to all", () => {
		writeFileSync(
			"/app/projects/api/src/health.ts",
			'@Authorize("read")\nexport class Health {}\n',
		);
		expect(discoverAuthorizeScopes("/app")).toEqual(["read:all"]);
	});

	it("skips spec files and other APIs' absence", () => {
		writeFileSync(
			"/app/projects/api/src/invoice.controller.ts",
			'@Authorize("read", "Invoice")\nexport class Invoice {}\n',
		);
		writeFileSync(
			"/app/projects/api/src/invoice.controller.spec.ts",
			'@Authorize("read", "ShouldNotSee")\nexport class Spec {}\n',
		);
		expect(discoverAuthorizeScopes("/app")).toEqual(["read:Invoice"]);
	});

	it("scans every API under projects/", () => {
		mkdirSync("/app/projects/billing/src", { recursive: true });
		writeFileSync("/app/projects/billing/package.json", JSON.stringify({ name: "billing" }));
		writeFileSync(
			"/app/projects/api/src/hello.ts",
			'@Authorize("read", "Hello")\nexport class Hello {}\n',
		);
		writeFileSync(
			"/app/projects/billing/src/bill.ts",
			'@Authorize("update", "Bill")\nexport class Bill {}\n',
		);
		expect(discoverAuthorizeScopes("/app")).toEqual(["read:Hello", "update:Bill"]);
	});
});

describe("mergeApiScopes / postmanRequestedScopes", () => {
	it("unions existing Auth0 permissions with newly discovered ones", () => {
		expect(mergeApiScopes(["read:Invoice"], ["read:Hello", "read:Invoice"])).toEqual([
			"read:Hello",
			"read:Invoice",
		]);
	});

	it("prefixes OIDC scopes for Postman PKCE", () => {
		expect(postmanRequestedScopes(["read:Hello", "read:Invoice"])).toBe(
			"openid profile email read:Hello read:Invoice",
		);
	});
});
