import { Codec } from "../util/index.js";

/** Times in milliseconds */
class Time {
	static second = 1000;
	static minute = 60 * Time.second;
	static hour = 60 * Time.minute;
	static day = 24 * Time.hour;
	static week = 7 * Time.day;
}

export namespace Auth {
	export type Session = {
		/** User ID */
		userId: string;

		/** User email */
		email: string;

		/** Expiration timestamp (ms) */
		expiration: number;
	};
}

export class Auth {
	/**
	 * User provided auth secret key (random 32+ character string)
	 * encoded and used as the `keyData` to create the key
	 */
	readonly #secret: string;

	constructor(secret?: string) {
		if (!secret) {
			// TODO probably remove this as it should be user provided, but keeping for now
			this.#secret = this.generateSecret();
			return;
		}

		this.#secret = secret;
	}

	/**
	 * @returns Random secret
	 */
	generateSecret() {
		return btoa(
			String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
		);
	}

	#cachedKey: CryptoKey | null = null;

	/**
	 * @returns `CryptoKey` for use in the Web Crypto API
	 */
	async key() {
		return (this.#cachedKey ??= await crypto.subtle.importKey(
			"raw",
			Codec.encode(this.#secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign", "verify"],
		));
	}

	#arrayToBase64(data: Uint8Array) {
		return btoa(String.fromCharCode(...data));
	}

	#base64ToArray(str: string) {
		return new Uint8Array(
			atob(str)
				.split("")
				.map((c) => c.charCodeAt(0)),
		);
	}

	async sign(payload: string) {
		// same key, same payload, same signature
		const sig = await crypto.subtle.sign(
			"HMAC",
			await this.key(),
			Codec.encode(payload),
		);
		const sigBase64 = this.#arrayToBase64(new Uint8Array(sig));

		return `${payload}.${sigBase64}`;
	}

	async verify(token: string) {
		const [payload, sigBase64] = token.split(".", 2);

		if (payload && sigBase64) {
			const sig = this.#base64ToArray(sigBase64);
			const valid = await crypto.subtle.verify(
				"HMAC",
				await this.key(),
				sig,
				Codec.encode(payload),
			);

			if (valid) return payload;
		}

		return null;
	}

	async createSession(user: Omit<Auth.Session, "expiration">) {
		const session: Auth.Session = {
			...user,
			expiration: Date.now() + Time.week,
		};

		const payload = this.#arrayToBase64(Codec.encode(JSON.stringify(session)));

		return this.sign(payload);
	}

	async validateSession(token: string) {
		const payload = await this.verify(token);

		if (payload) {
			try {
				const decoded = Codec.decode(this.#base64ToArray(payload));
				const session = JSON.parse(decoded) as Auth.Session;

				if (Date.now() < session.expiration) return session;
			} catch {}
		}

		return null;
	}
}
