import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { KeyedModel, SourceFile } from "../../models/source-file.js";

export type AdminUserConfig = {
	sub: string;
	email: string;
	password: string;
	username: string;
};

export type AuthConfig = {
	issuerBaseUrl: string;
	audience: string;
	adminUser?: AdminUserConfig;
};

/**
 * Data-carrier model for auth configuration.
 *
 * Registered by AuthFeature when auth0 is configured. Other features retrieve it
 * via workspace.getModel(WELL_KNOWN_FILES.AUTH_CONFIG).
 * Produces no files — exists solely so features can communicate auth details.
 */
export class AuthConfigModel implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.AUTH_CONFIG;

	public constructor(public readonly config: AuthConfig) {}

	public setAdminUser(adminUser: AdminUserConfig): void {
		this.config.adminUser = adminUser;
	}

	public files(): SourceFile[] {
		return [];
	}
}
