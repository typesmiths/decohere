import type { IContainer } from "../composition/index.js";

/** The {@link AppServer} the app starts last and stops first. Registered by a plugin such as `http`. */
export const AppServerToken = Symbol("AppServer");
export const HostedServiceHostToken = Symbol("HostedServiceHost");
export const ReadinessCheckToken = Symbol("ReadinessCheck");
/** The {@link StartSteps} `App.start` runs before hosted services: `builder.registerStartStep`. */
export const StartStepsToken = Symbol("StartSteps");

/** Work `App.start` does before hosted services start and the server listens. */
export type StartStep = (container: IContainer) => Promise<void> | void;
export type StartSteps = { readonly steps: readonly StartStep[] };
