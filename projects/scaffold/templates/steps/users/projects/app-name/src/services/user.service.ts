import { injectable } from "@decohere/crucible/decorators";
import { injectUnitOfWork, type IUnitOfWork } from "@decohere/data";
import type { Principal } from "@decohere/http";
import { UserEntity } from "../entities/user.entity.js";
import { UserEntityRepository } from "../repositories/user.repository.js";

function claimString(principal: Principal | undefined, key: string): string | undefined {
	const value = principal?.[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

@injectable()
export class UserService {
	public constructor(
		private readonly users: UserEntityRepository,
		@injectUnitOfWork() private readonly unitOfWork: IUnitOfWork,
	) {}

	/**
	 * Upsert a local profile keyed by JWT `sub`.
	 * Profile fields from the token fill gaps; seeded rows keep displayName/email/roles.
	 */
	public async ensureFromPrincipal(principal: Principal | undefined): Promise<UserEntity> {
		const sub = principal?.sub;
		if (!sub) {
			throw new Error("Authenticated request is missing principal.sub");
		}

		const email =
			claimString(principal, "email") ?? claimString(principal, "preferred_username");
		const displayFromToken =
			claimString(principal, "name") ?? claimString(principal, "nickname") ?? email;

		const existing = await this.users.findBySub(sub);
		if (existing) {
			if (!existing.email && email) existing.email = email;
			if (existing.displayName === existing.sub && displayFromToken) {
				existing.displayName = displayFromToken;
			}
			// Writes only what changed, if anything did.
			await this.unitOfWork.commit();
			return existing;
		}

		const created = new UserEntity();
		created.sub = sub;
		created.email = email ?? null;
		created.displayName = displayFromToken ?? sub;
		created.roles = Array.isArray(principal.roles)
			? principal.roles.filter((r): r is string => typeof r === "string")
			: [];
		this.users.add(created);
		await this.unitOfWork.commit();
		return created;
	}
}
