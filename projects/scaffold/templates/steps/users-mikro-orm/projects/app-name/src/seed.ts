import type { MikroORM } from "@mikro-orm/core";
import { UserEntity } from "./entities/user.entity.js";

/** Development: the local profile of the Auth0 admin user `decohere create` made, if any. */
export async function seedAdmin(orm: MikroORM): Promise<void> {
	const sub = process.env.AUTH0_ADMIN_USER_SUB;
	if (!sub) return;
	const em = orm.em.fork();
	if (await em.findOne(UserEntity, { sub })) return;
	const user = new UserEntity();
	user.sub = sub;
	user.email = process.env.AUTH0_ADMIN_USER_EMAIL ?? null;
	user.displayName = process.env.AUTH0_ADMIN_USERNAME ?? "admin";
	user.roles = ["admin"];
	await em.persist(user).flush();
}
