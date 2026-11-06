/** The {@link AppServer} the app starts last and stops first. Registered by a plugin such as `http`. */
export const AppServerToken = Symbol("AppServer");
export const HostedServiceHostToken = Symbol("HostedServiceHost");
export const ReadinessCheckToken = Symbol("ReadinessCheck");
