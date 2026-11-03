import type { Principal } from "./auth.types.js";

/**
 * Read-only view of the authenticated principal for the current request.
 * Inject this interface (via IPrincipalProviderToken) in any request-scoped
 * service to access the verified identity without coupling to the routing layer.
 */
export interface IPrincipalProvider {
	readonly currentPrincipal: Principal | undefined;
}

/**
 * Concrete, request-scoped implementation. The Router sets the principal
 * after JWT verification; downstream services consume it via IPrincipalProvider.
 *
 * @internal — framework use only. Inject IPrincipalProvider, not this class.
 */
export class PrincipalProvider implements IPrincipalProvider {
	private _principal: Principal | undefined;

	public get currentPrincipal(): Principal | undefined {
		return this._principal;
	}

	public setPrincipal(principal: Principal | undefined): void {
		this._principal = principal;
	}
}
