import { describe, expect, it } from "vitest";
import { extension } from "../../src/extensibility/extension.js";

class Host {
	public static instance = new Host();
	public n = 0;

	public bump(amount: number): number {
		this.n += amount;
		return this.n;
	}
}

class HostExtensions {
	@extension(Host, { static: true })
	public static grow(host: Host, amount: number): number {
		return host.bump(amount);
	}
}

void HostExtensions;

describe("extension({ static: true })", () => {
	it("installs a constructor method that runs on the singleton", () => {
		Host.instance.n = 0;
		expect((Host as unknown as { grow: (amount: number) => number }).grow(2)).toBe(2);
		expect(Host.instance.n).toBe(2);
	});
});
