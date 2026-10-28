import { Codec } from "../util/index.js";
import { AuthIssue } from "./issue.js";

/** Internal integrity protection with explicit authentication purposes. */
export class Token {
	static readonly #keys = new Map<string, Promise<CryptoKey>>();

	static #key(secret: string) {
		let key = Token.#keys.get(secret);
		if (!key) {
			key = crypto.subtle.importKey(
				"raw",
				Codec.encode(secret),
				{ name: "HMAC", hash: "SHA-256" },
				false,
				["sign", "verify"],
			);
			Token.#keys.set(secret, key);
		}
		return key;
	}

	/** Seal a payload for exactly one authentication purpose. */
	static async seal(
		secret: string,
		purpose: "session" | "passkey",
		value: string,
	) {
		const payload = `${purpose}:${value}`;
		return `${payload}.${Codec.Base64Url.encode(new Uint8Array(await crypto.subtle.sign("HMAC", await Token.#key(secret), Codec.encode(payload))))}`;
	}

	/** Verify both integrity and purpose before exposing the payload. */
	static async open(
		secret: string,
		purpose: "session" | "passkey",
		token: string,
	) {
		const dot = token.lastIndexOf(".");
		if (dot > 0 && token.startsWith(`${purpose}:`)) {
			try {
				if (
					await crypto.subtle.verify(
						"HMAC",
						await Token.#key(secret),
						Codec.Base64Url.decode(token.slice(dot + 1)),
						Codec.encode(token.slice(0, dot)),
					)
				)
					return token.slice(purpose.length + 1, dot);
			} catch {
				// Malformed signatures are authentication failures.
			}
		}
		throw new AuthIssue("token");
	}
}
