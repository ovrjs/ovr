import type { Context } from "../context/index.js";
import { Schema } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
import { AuthIssue } from "./issue.js";
import { Passkey } from "./passkey.js";

export namespace Auth {
	export interface Options {
		/** Secret key for signing sessions and challenges */
		readonly secret: string;

		/**
		 * Session duration in ms
		 *
		 * @default 1000 * 60 * 60 * 24 * 7
		 */
		readonly duration?: number;

		/**
		 * Sliding session refresh threshold (ms)
		 *
		 * @default duration / 4
		 */
		readonly refresh?: number;
	}

	export interface Session {
		/** User ID */
		readonly id: string;

		/** Session expiration time */
		readonly expiration: number;
	}

	/** Stored credential data */
	export interface Credential {
		/** Credential ID */
		id: string;

		/** Associated user ID */
		user: string;

		/** SPKI encoded public key as base64url */
		publicKey: string;
	}
}

/**
 * Stateless authentication helper with passkey support.
 *
 * Token semantics:
 * - `sign()`/`verify()` provide integrity only (tamper detection)
 * - Freshness/replay controls must be encoded in payload and/or enforced externally
 */
export class Auth {
	/** Cached auth keys in case of multiple App instances */
	static readonly #keys = new Map<string, Promise<CryptoKey>>();
	static readonly #cookieName = "__Host-auth-session";
	static readonly #hmac = "HMAC";
	static readonly #session = Schema.object({
		id: Schema.string(),
		expiration: Schema.number(),
	});

	/** Request context */
	readonly #c: Context;

	/** Auth user options */
	readonly options;

	/** Passkey methods */
	readonly passkey: Passkey;

	/**
	 * Create a new auth instance
	 *
	 * @param c Request context
	 * @param options Auth options
	 */
	constructor(c: Context, options: Auth.Options) {
		this.#c = c;
		this.options = Object.assign(
			{
				duration: Time.week,
				refresh: (options.duration ?? Time.week) / 4,
			} satisfies Pick<Auth.Options, "duration" | "refresh">,
			options,
		);
		this.passkey = new Passkey(c, this);
	}

	/** Gets the corresponding key for the app handling the request */
	get #key() {
		let key = Auth.#keys.get(this.options.secret);

		if (!key) {
			// new
			Auth.#keys.set(
				// in case there are multiple App instances
				this.options.secret,
				(key = crypto.subtle.importKey(
					"raw",
					Codec.encode(this.options.secret),
					{ name: Auth.#hmac, hash: "SHA-256" },
					false,
					["sign", "verify"],
				)),
			);
		}

		return key;
	}

	/**
	 * Sign a payload with the auth secret.
	 *
	 * Signing is integrity-only and does not add encryption, expiry, or one-time semantics.
	 *
	 * @param payload Unsigned payload
	 * @returns HMAC signed `payload.signature` token
	 */
	async sign(payload: string) {
		return `${payload}.${Codec.Base64Url.encode(
			new Uint8Array(
				await crypto.subtle.sign(
					Auth.#hmac,
					await this.#key,
					Codec.encode(payload),
				),
			),
		)}`;
	}

	/**
	 * Verify a signed token.
	 *
	 * Verification checks integrity only. Replay/freshness constraints are caller-defined.
	 *
	 * @param token Signed token
	 * @returns Verified payload
	 * @throws Auth.Issue if the token is invalid
	 */
	async verify(token: string) {
		const dot = token.lastIndexOf(".");

		if (dot !== -1) {
			const payload = token.slice(0, dot);

			try {
				if (
					await crypto.subtle.verify(
						Auth.#hmac,
						await this.#key,
						Codec.Base64Url.decode(token.slice(dot + 1)), // signature
						Codec.encode(payload),
					)
				) {
					return payload;
				}
			} catch {
				// invalid signature encoding
			}
		}

		throw new AuthIssue("token");
	}

	/**
	 * Set/expire the auth session cookie
	 *
	 * @param session
	 */
	async #setCookie<S extends Auth.Session | null>(session: S): Promise<S> {
		this.#c.cookie.set(
			Auth.#cookieName,
			session
				? await this.sign(
						Codec.Base64Url.encode(Codec.encode(JSON.stringify(session))),
					)
				: "",
			{
				httpOnly: true,
				secure: true,
				sameSite: "Lax",
				maxAge: session ? Math.floor(this.options.duration / 1000) : 0,
			},
		);

		return session;
	}

	/**
	 * Reads the current auth session from the cookie
	 *
	 * @returns Current session or `null`, invalid session token/payload clears the cookie and returns `null`
	 */
	async session() {
		const token = this.#c.cookie.get(Auth.#cookieName);
		if (!token) return null;

		try {
			const payload = await this.verify(token);
			let decoded: string;

			try {
				decoded = Codec.decode(Codec.Base64Url.decode(payload));
			} catch {
				throw new AuthIssue("session payload");
			}

			const session = Schema.json(Auth.#session).parse(decoded);

			if (session.issues) throw session;

			const now = Date.now();

			if (now < session.data.expiration) {
				// has not expired
				return session.data.expiration - now < this.options.refresh
					? // refresh
						this.#setCookie({
							...session.data,
							expiration: now + this.options.duration,
						})
					: // return as is
						session.data;
			}
		} catch (e) {
			if (!(e instanceof AuthIssue || e instanceof Schema.AggregateIssue)) {
				throw e;
			}
		}

		return this.logout();
	}

	/**
	 * Log a user in by issuing a new session cookie.
	 *
	 * @param id User ID to login
	 * @returns New session
	 */
	login(id: string) {
		return this.#setCookie({
			id,
			expiration: Date.now() + this.options.duration,
		});
	}

	/** Logs out the user by expiring the session cookie */
	logout() {
		return this.#setCookie(null);
	}
}
