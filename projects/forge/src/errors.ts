export { WorkspaceConfigurationError } from "@decohere/workspace";
export class ForgeError extends Error {}

export function formatUnknownError(reason: unknown): string {
	if (reason instanceof Error) {
		return reason.message;
	}

	if (typeof reason === "string") {
		return reason;
	}

	try {
		return JSON.stringify(reason);
	} catch {
		return "Unknown error";
	}
}
