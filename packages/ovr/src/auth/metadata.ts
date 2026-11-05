/// <reference types="node" />
import { Codec, Mime, Size, Time } from "../util/index.js";

/**
 * Fetches OAuth client ID metadata documents, from public addresses only.
 *
 * A client ID is a URL the agent chooses, so a hostname could resolve to the
 * server's own network. The address is checked when the connection resolves
 * it, so the name cannot pass the check and then resolve somewhere else.
 * This needs Node.js or Bun, other runtimes cannot check the connection's
 * address.
 */
export class Metadata {
	/** Largest document, as the specification recommends */
	static readonly #limit = 5 * Size.kb;

	/**
	 * Special-use addresses, RFC 6890 and the IANA registries. IPv4-mapped
	 * addresses are checked against the IPv4 ranges, so `::ffff:0:0/96` is not
	 * listed, it would block every IPv4 address.
	 */
	static readonly #special = [
		["0.0.0.0", 8],
		["10.0.0.0", 8],
		["100.64.0.0", 10],
		["127.0.0.0", 8],
		["169.254.0.0", 16],
		["172.16.0.0", 12],
		["192.0.0.0", 24],
		["192.0.2.0", 24],
		["192.88.99.0", 24],
		["192.168.0.0", 16],
		["198.18.0.0", 15],
		["198.51.100.0", 24],
		["203.0.113.0", 24],
		["224.0.0.0", 4],
		["240.0.0.0", 4],
		["::", 128],
		["::1", 128],
		["64:ff9b::", 96],
		["64:ff9b:1::", 48],
		["100::", 64],
		["2001::", 23],
		["2001:db8::", 32],
		["2002::", 16],
		["fc00::", 7],
		["fe80::", 10],
		["ff00::", 8],
	] as const;

	/** `true` in Node.js and Bun, where the connection's address can be checked */
	static get supported() {
		return /^(?:Node\.js|Bun)\//.test(navigator.userAgent);
	}

	/**
	 * @param url Client ID
	 * @returns The parsed document, `undefined` when the host's answer is final,
	 * such as a 404 or an invalid document, or `null` when a retry may succeed:
	 * a timeout, a network error, or a 5xx or 429 response
	 */
	static async fetch(url: URL): Promise<unknown> {
		const https = process.getBuiltinModule("node:https");
		const dns = process.getBuiltinModule("node:dns");
		const net = process.getBuiltinModule("node:net");

		const blocked = new net.BlockList();
		for (const [address, prefix] of Metadata.#special)
			blocked.addSubnet(address, prefix, net.isIPv6(address) ? "ipv6" : "ipv4");

		const special = (address: string) =>
			blocked.check(address, net.isIPv6(address) ? "ipv6" : "ipv4");

		// an address in the URL is connected to without a lookup
		const host = url.hostname.replace(/^\[|\]$/g, "");
		if (net.isIP(host) && special(host)) return;

		// set when the failure is the host's final answer, not a passing one
		let final = false;

		const bytes = await new Promise<Uint8Array | undefined>((resolve) => {
			// for the whole download, a response sent slowly cannot hold it open
			const deadline = setTimeout(() => {
				req.destroy();
				done();
			}, 5 * Time.second);
			const done = (bytes?: Uint8Array) => {
				clearTimeout(deadline);
				resolve(bytes);
			};

			const req = https.get(
				url,
				{
					// a new connection, a pooled one may not have had its address checked
					agent: false,
					headers: { accept: Mime.type.json },
					lookup: (hostname, options, callback) =>
						dns.lookup(hostname, { ...options, all: true }, (error, all) => {
							if (error) return callback(error, "", 0);
							if (!all.length || all.some(({ address }) => special(address))) {
								final = true;
								return callback(new Error("Special-use address"), "", 0);
							}
							if (options.all) return (callback as Function)(null, all);
							callback(null, all[0]!.address, all[0]!.family);
						}),
				},
				(res) => {
					// redirects are not followed
					if (res.statusCode !== 200) {
						const status = res.statusCode ?? 0;
						final = status < 500 && status !== 429;
						res.destroy();
						return done();
					}

					const chunks: Uint8Array[] = [];
					let size = 0;
					res.on("data", (chunk: Uint8Array) => {
						if ((size += chunk.length) > Metadata.#limit) {
							final = true;
							res.destroy();
							return done();
						}
						chunks.push(chunk);
					});
					res.on("end", () => done(Buffer.concat(chunks)));
					// the first of these settles the download, closing early is a failure
					res.on("close", () => done());
				},
			);
			req.on("error", () => done());
		});

		if (!bytes) return final ? undefined : null;

		try {
			// a document of `null` is invalid, not a passing failure
			return JSON.parse(Codec.decode(bytes)) ?? undefined;
		} catch {
			return;
		}
	}
}
