import { describe, expect, it } from "vitest";
import {
	assessTokenLifetime,
	buildDescription,
	CREDENTIALS,
	credentialProfile,
	issueTitle,
	parseExpiresAt,
	rotationCommands,
	runNudge,
	suggestedNextExpiry,
} from "../../src/github/credential-nudge.mjs";

/** Records each upsert and answers like a newly opened issue. */
function recordUpserts() {
	/** @type {{ title: string, body: string }[]} */
	const upserts = [];
	const upsert = (options) => {
		upserts.push(options);
		return {
			number: 9,
			url: "https://github.com/typesmiths/decohere/issues/9",
			created: true,
		};
	};
	return { upserts, upsert };
}

function inDays(days) {
	return suggestedNextExpiry(Date.now(), days);
}

describe("credential-nudge", () => {
	it("parses YYYY-MM-DD as a UTC day", () => {
		expect(parseExpiresAt("2026-11-19")).toBe(Date.UTC(2026, 10, 19));
		expect(parseExpiresAt("")).toBeNull();
	});

	it("is ok more than 14 days out, warns inside the window, expires on the day", () => {
		const expiresAtMs = Date.UTC(2026, 10, 19);
		const now = (day) => Date.UTC(2026, 10, day, 15);
		expect(assessTokenLifetime({ now: now(1), expiresAtMs }).kind).toBe("ok");
		expect(assessTokenLifetime({ now: now(5), expiresAtMs })).toEqual({
			kind: "warn",
			daysLeft: 14,
		});
		expect(assessTokenLifetime({ now: now(18), expiresAtMs }).kind).toBe("warn");
		expect(assessTokenLifetime({ now: now(19), expiresAtMs })).toEqual({
			kind: "expired",
			daysLeft: 0,
		});
		expect(assessTokenLifetime({ now: now(20), expiresAtMs }).kind).toBe("expired");
		expect(assessTokenLifetime({ expiresAtMs: null }).kind).toBe("missing");
	});

	it("builds the rotation issue for a credential profile", () => {
		const npm = credentialProfile("npm");
		expect(rotationCommands(npm, "2027-02-17", "typesmiths/decohere")).toContain(
			"gh secret set NODE_AUTH_TOKEN --repo typesmiths/decohere",
		);
		expect(rotationCommands(npm, "2027-02-17", "typesmiths/decohere")).toContain(
			"gh variable set NODE_AUTH_TOKEN_EXPIRES_AT --repo typesmiths/decohere --body 2027-02-17",
		);
		expect(issueTitle(npm, "2026-11-19")).toBe(
			"chore(security): rotate NODE_AUTH_TOKEN (expires 2026-11-19)",
		);
		const body = buildDescription(npm, {
			kind: "warn",
			expiresYmd: "2026-11-19",
			daysLeft: 14,
			rejected: false,
		});
		expect(body).toContain(CREDENTIALS.npm.failImpact);
		expect(suggestedNextExpiry(Date.UTC(2026, 7, 21), 90)).toBe("2026-11-19");
		expect(() => credentialProfile("ghcr")).toThrow(/Unknown NUDGE_CREDENTIAL/);
	});

	it("files nothing and passes while the token has more than 14 days left", async () => {
		const { upserts, upsert } = recordUpserts();
		const env = { NUDGE_CREDENTIAL: "npm", NODE_AUTH_TOKEN_EXPIRES_AT: inDays(30) };
		expect(await runNudge(env, upsert)).toBe(0);
		expect(upserts).toEqual([]);
	});

	it("files a rotation issue but lets Publish continue inside the warning window", async () => {
		const { upserts, upsert } = recordUpserts();
		const expires = inDays(10);
		const env = { NUDGE_CREDENTIAL: "npm", NODE_AUTH_TOKEN_EXPIRES_AT: expires };
		expect(await runNudge(env, upsert)).toBe(0);
		expect(upserts).toHaveLength(1);
		expect(upserts[0].title).toBe(
			`chore(security): rotate NODE_AUTH_TOKEN (expires ${expires})`,
		);
		expect(upserts[0].body).toContain("Close this issue, then retry Publish");
	});

	it("files a rotation issue and stops Publish once the token has expired or was rejected", async () => {
		const expired = recordUpserts();
		const env = { NUDGE_CREDENTIAL: "npm", NODE_AUTH_TOKEN_EXPIRES_AT: inDays(0) };
		expect(await runNudge(env, expired.upsert)).toBe(1);
		expect(expired.upserts).toHaveLength(1);

		const rejected = recordUpserts();
		const rejectedEnv = {
			...env,
			NODE_AUTH_TOKEN_EXPIRES_AT: inDays(60),
			NUDGE_REJECTED: "1",
		};
		expect(await runNudge(rejectedEnv, rejected.upsert)).toBe(1);
		expect(rejected.upserts[0].body).toContain(CREDENTIALS.npm.rejectedWhy);
	});
});
