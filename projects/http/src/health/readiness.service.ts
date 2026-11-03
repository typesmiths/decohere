import { inject, injectable } from "@decohere/crucible/decorators";
import { HostedServiceHostToken, ReadinessCheckToken } from "../const.js";
import type { HostedServiceHost } from "../hosting/hosted-service-host.js";
import type { IReadinessCheck, ReadinessResult } from "./readiness.types.js";

@injectable()
export class ReadinessService {
	private readonly checks: readonly IReadinessCheck[];

	public constructor(
		@inject(ReadinessCheckToken) checks: IReadinessCheck[] = [],
		@inject(HostedServiceHostToken) private readonly hostedServices?: HostedServiceHost,
	) {
		this.checks = checks;
	}

	/** Registered checks, then each started hosted service that has a `check()` (still warming up). */
	public async checkAll(): Promise<ReadinessResult> {
		const failures: string[] = [];
		const probes = [...this.checks, ...(this.hostedServices?.readinessChecks() ?? [])];
		for (const probe of probes) {
			try {
				await probe.check();
			} catch {
				failures.push(probe.name);
			}
		}
		if (failures.length > 0) {
			return { ok: false, failures };
		}
		return { ok: true };
	}
}
