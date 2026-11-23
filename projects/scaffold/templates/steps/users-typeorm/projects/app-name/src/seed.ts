import type { DataSource } from "typeorm";
import { UserEntity } from "./entities/user.entity.js";

/** Development: the local profile of the Auth0 admin user `decohere create` made, if any. */
export async function seedAdmin(dataSource: DataSource): Promise<void> {
	const sub = process.env.AUTH0_ADMIN_USER_SUB;
	if (!sub) return;
	const users = dataSource.getRepository(UserEntity);
	if (await users.findOne({ where: { sub } })) return;
	const user = new UserEntity();
	user.sub = sub;
	user.email = process.env.AUTH0_ADMIN_USER_EMAIL ?? null;
	user.displayName = process.env.AUTH0_ADMIN_USERNAME ?? "admin";
	user.roles = ["admin"];
	await users.save(user);
}
