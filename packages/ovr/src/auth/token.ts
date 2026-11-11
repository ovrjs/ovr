import { Codec } from "../util/index.js";
import type { Auth } from "./index.js";
import { Issue } from "./issue.js";

/** Internal integrity protection with explicit authentication purposes. */
export class Token {
	static readonly #keys = new Map<string, Promise<CryptoKey>>();

	static #key(secret: string) {
		return Token.#keys.getOrInsertComputed(secret, () =>
			crypto.subtle.importKey(
				"raw",
				Codec.encode(secret),
				{ name: "HMAC", hash: "SHA-256" },
				false,
				["sign", "verify"],
			),
		);
	}

	/** @returns A new random value of 256 bits, base64url, such as a challenge or code */
	static random() {
		return Codec.Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)));
	}

	/** Seal a payload for exactly one authentication purpose. */
	static async seal(
		secret: Auth.Options["secret"],
		purpose: "session" | "passkey" | "consent",
		value: string,
	) {
		const payload = `${purpose}:${value}`;
		return `${payload}.${Codec.Base64Url.encode(new Uint8Array(await crypto.subtle.sign("HMAC", await Token.#key([secret].flat()[0]!), Codec.encode(payload))))}`;
	}

	/** Verify both integrity and purpose before exposing the payload. */
	static async open(
		secret: Auth.Options["secret"],
		purpose: "session" | "passkey" | "consent",
		token: string,
	) {
		const dot = token.lastIndexOf(".");
		if (dot > 0 && token.startsWith(`${purpose}:`)) {
			try {
				const text = token.slice(dot + 1);
				const signature = Codec.Base64Url.decode(text);
				// one spelling per signature, as it was issued
				if (Codec.Base64Url.encode(signature) !== text)
					throw new Issue("token");
				const payload = Codec.encode(token.slice(0, dot));
				for (const key of [secret].flat())
					if (
						await crypto.subtle.verify(
							"HMAC",
							await Token.#key(key),
							signature,
							payload,
						)
					)
						return token.slice(purpose.length + 1, dot);
			} catch {
				// Malformed signatures are authentication failures.
			}
		}
		throw new Issue("token");
	}
}
