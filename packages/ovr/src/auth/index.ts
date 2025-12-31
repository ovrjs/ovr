import type { Context } from "../context/index.js";
import { Codec, Time } from "../util/index.js";

export namespace Auth {
	export type Options = {
		/** Secret key for signing sessions */
		readonly secret: string;

		/**
		 * Cookie name
		 *
		 * @default "__Host-session"
		 */
		readonly cookie?: string;

		/**
		 * Session duration in ms (default: 1 week)
		 *
		 * @default 1000 * 60 * 60 * 24 * 7
		 */
		readonly duration?: number;

		/**
		 * Sliding session refresh threshold in ms.
		 * Session is extended when remaining time < threshold.
		 *
		 * @default duration / 4
		 */
		readonly refresh?: number;

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
 * Sessions use a sliding window and are extended on each valid access.
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
			{
				cookie: `${options.secure !== false ? "__Host-" : ""}session`,
				duration: Time.week,
				refresh: (options.duration ?? Time.week) / 4,
				secure: true,
			} satisfies Omit<Auth.Options, "secret">,
			options,
		);
	}

	/**
	 * Lazily imports the configured secret into a `CryptoKey` for HMAC signing.
	 *
	 * The key is cached across requests by secret to avoid repeated imports.
	 */
	get #key() {
		let key = Auth.#keys.get(this.#options.secret);

		if (!key) {
			Auth.#keys.set(
				this.#options.secret,
				(key = crypto.subtle.importKey(
					"raw",
					Codec.encode(this.#options.secret),
					{ name: "HMAC", hash: "SHA-256" },
					false,
					["sign", "verify"],
				)),
			);
		}

		return key;
	}

	/**
	 * Creates an HMAC signature for a given payload.
	 *
	 * @param payload Payload to sign
	 * @returns Token in the format `${payload}.${signature}`
	 */
	async #sign(payload: string) {
		return `${payload}.${Codec.base64.encode(
			new Uint8Array(
				await crypto.subtle.sign(
					"HMAC",
					await this.#key,
					Codec.encode(payload),
				),
			),
		)}` as const;
	}

	#setCookie(session: Auth.Session): Promise<Auth.Session>;
	#setCookie(session?: undefined): Promise<null>;
	async #setCookie(session?: Auth.Session) {
		this.#c.cookie.set(
			this.#options.cookie,
			session
				? // token
					await this.#sign(
						// payload
						Codec.base64.encode(Codec.encode(JSON.stringify(session))),
					)
				: // remove
					"",
			{
				httpOnly: true,
				secure: this.#options.secure,
				sameSite: "Lax",
				maxAge: session
					? // convert to seconds
						Math.floor(this.#options.duration / 1000)
					: // expire
						0,
			},
		);

		return session ?? null;
	}

	/**
	 * Returns the current request session if present and valid.
	 * Automatically extends the session expiration on valid access.
	 *
	 * @returns Valid session or `null`
	 */
	async session() {
		const token = this.#c.cookie.get(this.#options.cookie);

		if (!token) return null;

		const [payload, sigBase64] = token.split(".", 2);

		if (payload && sigBase64) {
			try {
				if (
					await crypto.subtle.verify(
						"HMAC",
						await this.#key,
						Codec.base64.decode(sigBase64),
						Codec.encode(payload),
					)
				) {
					// valid
					const session = JSON.parse(
						Codec.decode(Codec.base64.decode(payload)),
					) as Auth.Session;

					if (Date.now() < session.expiration) {
						return session.expiration - Date.now() < this.#options.refresh
							? this.login(session) // refresh
							: session;
					}
				}
			} catch {}
		}

		// invalid or expired token
		return this.logout();
	}

	/**
	 * Logs a user in by creating a session and setting the session cookie.
	 *
	 * @param user User session data
	 * @returns Created session
	 */
	login(user: Auth.Session | Omit<Auth.Session, "expiration">) {
		return this.#setCookie({
			...user,
			expiration: Date.now() + this.#options.duration,
		});
	}

	/** Logs the current user out by expiring the session cookie. */
	logout() {
		return this.#setCookie();
	}
}
