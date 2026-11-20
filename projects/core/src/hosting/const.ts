import type { IContainer } from "../composition/index.js";

/** The {@link AppServer} the app starts last and stops first. Registered by a plugin such as `http`. */
export const AppServerToken = Symbol("AppServer");
export const HostedServiceHostToken = Symbol("HostedServiceHost");
export const ReadinessCheckToken = Symbol("ReadinessCheck");
/** Work the app does when it starts, before its hosted services: `builder.registerStartStep`. */
export type StartStep = (container: IContainer) => Promise<void> | void;
