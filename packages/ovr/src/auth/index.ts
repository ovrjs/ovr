import type { Context } from "../context/index.js";
import { Schema } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
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
	 * @param payload
	 * @returns HMAC signed `payload.signature` with auth secret
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
	 * @param token signed token
	 * @returns valid payload
	 */
	async verify(token: string) {
		const dot = token.lastIndexOf(".");

		if (dot !== -1) {
			const payload = token.slice(0, dot);

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
		}

		throw new Error("Invalid token");
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
	 * @returns current or null
	 */
	async session() {
		const token = this.#c.cookie.get(Auth.#cookieName);
		if (!token) return null;

		try {
			const payload = await this.verify(token);
			const now = Date.now();

			const session = Schema.json(Auth.#session).parse(
				Codec.decode(Codec.Base64Url.decode(payload)),
			);

			if (session.issues) throw session;

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
		} catch {
			// invalid payload
		}

		return this.logout();
	}

	/**
	 * @param id user ID to login
	 * @returns new session
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
