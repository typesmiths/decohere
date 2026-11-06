import type { App } from "@decohere/core/hosting";

/**
 * Bind an OS-assigned port (`listen(0)`) on loopback and return the advertised origin.
 */
export async function listenEphemeral(app: App): Promise<string> {
	await app.start({ port: 0, host: "127.0.0.1" });
	const address = app.addresses[0];
	if (address == null) {
		throw new Error("app.start({ port: 0 }) advertised no IPv4 address");
	}
	return address;
}
