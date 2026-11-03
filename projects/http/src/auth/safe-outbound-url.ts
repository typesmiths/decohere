import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Validate URLs used for OIDC discovery / JWKS fetches to reduce SSRF risk.
 *
 * - http(s) only; https required except loopback (local IdP tests)
 * - no credentials in the URL
 * - hostname must not resolve to private, link-local, or metadata ranges
 *   (loopback allowed only when NODE_ENV is development/dev/test)
 */
export async function assertSafeOutboundUrl(raw: string, label: string): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`Invalid ${label}: ${raw}`);
	}

	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error(`${label} must use http or https (got ${url.protocol})`);
	}

	if (url.username || url.password) {
		throw new Error(`${label} must not include credentials`);
	}

	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	if (isBlockedHostname(hostname)) {
		throw new Error(`${label} host is not allowed (${hostname})`);
	}

	const ips = await resolveIps(hostname);
	const allowLoopback = isLoopbackAllowed();
	for (const ip of ips) {
		if (isBlockedIp(ip, allowLoopback)) {
			throw new Error(`${label} resolves to a blocked address (${ip})`);
		}
	}

	if (url.protocol === "http:") {
		const loopbackOnly =
			isLoopbackHostname(hostname) || (ips.length > 0 && ips.every((ip) => isLoopbackIp(ip)));
		if (!loopbackOnly || !allowLoopback) {
			throw new Error(`${label} must use https unless targeting loopback in development/test`);
		}
	}

	return url;
}

function isLoopbackAllowed(): boolean {
	const env = process.env.NODE_ENV ?? "";
	return env === "development" || env === "dev" || env === "test";
}

function isLoopbackHostname(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isBlockedHostname(hostname: string): boolean {
	const lower = hostname.toLowerCase();
	return (
		lower === "metadata.google.internal" ||
		lower === "metadata" ||
		lower.endsWith(".metadata.google.internal")
	);
}

async function resolveIps(hostname: string): Promise<string[]> {
	if (isIP(hostname)) {
		return [hostname];
	}
	const results = await lookup(hostname, { all: true, verbatim: true });
	return results.map((r) => r.address);
}

function isLoopbackIp(ip: string): boolean {
	const list = new BlockList();
	list.addSubnet("127.0.0.0", 8, "ipv4");
	list.addAddress("::1", "ipv6");
	list.addSubnet("::ffff:127.0.0.0", 104, "ipv6");
	return list.check(ip);
}

function isBlockedIp(ip: string, allowLoopback: boolean): boolean {
	if (allowLoopback && isLoopbackIp(ip)) {
		return false;
	}

	const list = new BlockList();
	// IPv4 special-use / private
	list.addSubnet("0.0.0.0", 8, "ipv4");
	list.addSubnet("10.0.0.0", 8, "ipv4");
	list.addSubnet("100.64.0.0", 10, "ipv4"); // shared address space
	list.addSubnet("127.0.0.0", 8, "ipv4");
	list.addSubnet("169.254.0.0", 16, "ipv4"); // link-local / cloud metadata
	list.addSubnet("172.16.0.0", 12, "ipv4");
	list.addSubnet("192.168.0.0", 16, "ipv4");
	list.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
	// IPv6
	list.addAddress("::1", "ipv6");
	list.addSubnet("fc00::", 7, "ipv6"); // unique local
	list.addSubnet("fe80::", 10, "ipv6"); // link-local

	if (list.check(ip)) {
		return true;
	}

	// Mapped IPv4 inside IPv6 (::ffff:a.b.c.d)
	const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
	if (mapped) {
		return isBlockedIp(mapped[1], allowLoopback);
	}

	return false;
}
