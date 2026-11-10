import type { Orm } from "../webapi/database-provider.js";
import type { WorkspaceChanges } from "../templates/workspace-changes.js";
import { appSource } from "./app-source.js";

/** An app a step changes: its folder under `projects/`, and its local port. */
export type AppTarget = { name: string; port: number };

type Manifest = { dependencies?: Record<string, string> };

/** The ORM an app maps its tables with, from the provider package it depends on. */
function ormOf(changes: WorkspaceChanges, app: string): Orm | undefined {
	const text = changes.read(`projects/${app}/package.json`);
	const dependencies = text == null ? {} : ((JSON.parse(text) as Manifest).dependencies ?? {});
	if ("@decohere/data-mikro-orm" in dependencies) return "mikro-orm";
	if ("@decohere/data-typeorm" in dependencies) return "typeorm";
	return undefined;
}

/** True when the app checks tokens: its app.ts uses the auth plugin. */
function hasAuth(changes: WorkspaceChanges, app: string): boolean {
	return appSource.read(changes, app).includes(".use(auth(");
}

export const apps = { hasAuth, ormOf };
