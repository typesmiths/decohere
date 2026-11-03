/**
 * A dependency probe run by `GET /ready`.
 * Register instances under {@link ReadinessCheckToken} (multi-inject).
 */
export interface IReadinessCheck {
	readonly name: string;
	check(): Promise<void>;
}

export type ReadinessResult = { ok: true } | { ok: false; failures: string[] };
