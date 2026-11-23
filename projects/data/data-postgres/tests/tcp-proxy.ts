import { createConnection, createServer, type Socket } from "node:net";

/** A TCP proxy in front of a server, for tests: while down it drops every connection, like a database not up yet. */
export type TcpProxy = {
	host: string;
	port: number;
	/** Forward connections from now on. */
	up(): void;
	/** Drop new connections, and cut the open ones. */
	down(): void;
	stop(): Promise<void>;
};

export async function startTcpProxy(
	target: { host: string; port: number },
	options: { up?: boolean } = {},
): Promise<TcpProxy> {
	let forwarding = options.up ?? false;
	const open = new Set<Socket>();
	const track = (socket: Socket) => {
		open.add(socket);
		socket.on("close", () => open.delete(socket));
	};
	const server = createServer((client) => {
		track(client);
		if (!forwarding) {
			client.destroy();
			return;
		}
		const upstream = createConnection(target);
		track(upstream);
		// Either side failing or closing ends the pair, as a dropped network link would.
		client.on("error", () => upstream.destroy());
		upstream.on("error", () => client.destroy());
		client.pipe(upstream).pipe(client);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address == null || typeof address === "string") {
		throw new Error("The TCP proxy has no port");
	}
	const cutAll = () => {
		for (const socket of open) {
			socket.destroy();
		}
	};
	return {
		host: "127.0.0.1",
		port: address.port,
		up() {
			forwarding = true;
		},
		down() {
			forwarding = false;
			cutAll();
		},
		stop() {
			cutAll();
			return new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}
