import type { Context } from "../context/index.js";
import { Codec } from "../util/index.js";

/** Times in milliseconds */
class Time {
	static readonly second = 1000;
	static readonly minute = 60 * Time.second;
	static readonly hour = 60 * Time.minute;
	static readonly day = 24 * Time.hour;
	static readonly week = 7 * Time.day;
}

export namespace Auth {
	export type Options = {
		/** Secret key for signing sessions */
		readonly secret: string;

		/**
		 * Cookie name
		 *
		 * @default "session"
		 */
		readonly cookie?: string;

		/**
		 * Session duration in ms (default: 1 week)
		 *
		 * @default 1000 * 60 * 60 * 24 * 7
		 */
		readonly duration?: number;

		/**
		 * Secure cookies, useful to set to `false` for local development
		 *
		 * @default true
		 */
		readonly secure?: boolean;
	};

	export type Session = {
		/** User ID */
		readonly id: string;

		/** Expiration timestamp (ms) */
		readonly expiration: number;
	};
}

/**
 * Stateless authentication helper.
 *
 * This class creates and validates signed session cookies without a database.
 * Sessions are stored entirely in the cookie and verified using HMAC-SHA256.
 */
export class Auth {
	/** Cache of imported Web Crypto keys */
	static readonly #keys = new Map<string, Promise<CryptoKey>>();

	/** Normalized options for this request */
	readonly #options;

	/** Current request context */
	readonly #c: Context;

	/**
	 * Create a new `Auth` instance for the current request.
	 *
	 * @param c Request context
	 * @param options Auth configuration
	 */
	constructor(c: Context, options: Auth.Options) {
		this.#c = c;
		this.#options = Object.assign(
			{ cookie: "session", duration: Time.week, secure: true } satisfies Omit<
				Auth.Options,
				"secret"
			>,
			options,
		);
	}

	/**
	 * Generates a random secret suitable for use as `App.Options.auth.secret`.
	 *
	 * This value should be generated once and stored in an environment variable.
	 *
	 * @returns Random secret
	 */
	static secret() {
		return btoa(
			String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
		);
	}

	/**
	 * Lazily imports the configured secret into a `CryptoKey` for HMAC signing.
	 *
	 * The key is cached across requests by secret to avoid repeated imports.
	 */
	get #key() {
		let promise = Auth.#keys.get(this.#options.secret);

		if (!promise) {
			Auth.#keys.set(
				this.#options.secret,
				(promise = crypto.subtle.importKey(
					"raw",
					Codec.encode(this.#options.secret),
					{ name: "HMAC", hash: "SHA-256" },
					false,
					["sign", "verify"],
				)),
			);
		}

		return promise;
	}

	/**
	 * Encodes bytes into a base64 string.
	 *
	 * @param data Bytes
	 * @returns Base64 encoded string
	 */
	#arrayToBase64(data: Uint8Array) {
		return btoa(String.fromCharCode(...data));
	}

	/**
	 * Decodes a base64 string into bytes.
	 *
	 * @param str Base64 encoded string
	 * @returns Bytes
	 */
	#base64ToArray(str: string) {
		return new Uint8Array(Array.from(atob(str), (c) => c.charCodeAt(0)));
	}

	/**
	 * Creates an HMAC signature for a given payload.
	 *
	 * Signing provides integrity: the payload can be read by clients, but cannot
	 * be modified without invalidating the signature.
	 *
	 * @param payload Payload to sign
	 * @returns Token in the format `${payload}.${signature}`
	 */
	async #sign(payload: string) {
		// same key, same payload, same signature
		const sig = await crypto.subtle.sign(
			"HMAC",
			await this.#key,
			Codec.encode(payload),
		);
		const sigBase64 = this.#arrayToBase64(new Uint8Array(sig));

		return `${payload}.${sigBase64}` as const;
	}

	/**
	 * Verifies a signed token and returns the payload if valid.
	 *
	 * @param token Token in the format `${payload}.${signature}`
	 * @returns Payload if valid, otherwise `null`
	 */
	async #verify(token: string) {
		const [payload, sigBase64] = token.split(".", 2);

		if (payload && sigBase64) {
			const sig = this.#base64ToArray(sigBase64);
			const valid = await crypto.subtle.verify(
				"HMAC",
				await this.#key,
				sig,
				Codec.encode(payload),
			);

			if (valid) return payload;
		}

		return null;
	}

	/**
	 * Creates a session object and signs it into a cookie token.
	 *
	 * The session is JSON encoded, base64 encoded, then signed.
	 *
	 * @param user Session data excluding expiration
	 * @returns Session and signed token
	 */
	async #createSession(user: Omit<Auth.Session, "expiration">) {
		const session: Auth.Session = {
			...user,
			expiration: Date.now() + this.#options.duration,
		};

		const payload = this.#arrayToBase64(Codec.encode(JSON.stringify(session)));

		return { session, token: await this.#sign(payload) };
	}

	/**
	 * Validates a session token and returns the parsed session if valid.
	 *
	 * This verifies the HMAC signature and checks session expiration.
	 *
	 * @param token Signed session token
	 * @returns Valid session or `null`
	 */
	async #validateSession(token: string) {
		const payload = await this.#verify(token);

		if (payload) {
			try {
				const decoded = Codec.decode(this.#base64ToArray(payload));
				const session = JSON.parse(decoded) as Auth.Session;

				if (Date.now() < session.expiration) return session;
			} catch {}
		}

		return null;
	}

	/**
	 * Returns the current request session if present and valid.
	 *
	 * @returns Valid session or `null`
	 */
	async session() {
		const token = this.#c.cookie.get(this.#options.cookie);
		return token ? this.#validateSession(token) : null;
	}

	/**
	 * Logs a user in by creating a session and setting the session cookie.
	 *
	 * @param user Session data excluding expiration
	 * @returns Created session
	 */
	async login(user: Omit<Auth.Session, "expiration">) {
		const { token, session } = await this.#createSession(user);

		this.#c.cookie.set(this.#options.cookie, token, {
			httpOnly: true,
			secure: this.#options.secure,
			sameSite: "Lax",
			maxAge: Math.floor(this.#options.duration / 1000),
		});

		return session;
	}

	/** Logs the current user out by expiring the session cookie. */
	logout() {
		this.#c.cookie.set(this.#options.cookie, "", {
			httpOnly: true,
			secure: this.#options.secure,
			sameSite: "Lax",
			maxAge: 0,
		});
	}

	/**
	 * Sets an unauthorized response and returns `null`.
	 *
	 * @returns null
	 */
	#unauth() {
		this.#c.res.status = 401;
		this.#c.res.body = "Unauthorized";
		return null;
	}

	/**
	 * Requires a valid session.
	 *
	 * - If the session cookie is missing, sets a `401` response.
	 * - If the session cookie is present but invalid/expired, clears it and sets
	 * a `401` response.
	 *
	 * @returns Valid `session` or `null`
	 */
	async require() {
		const token = this.#c.cookie.get(this.#options.cookie);
		if (!token) return this.#unauth();

		const session = await this.#validateSession(token);
		if (session) return session;

		// invalid or expired token
		this.logout();
		return this.#unauth();
	}
}
