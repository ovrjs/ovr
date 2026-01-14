import type { Context } from "../context/index.js";
import { Route } from "../route/index.js";
import { S } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
import { Passkey } from "./passkey.js";

export namespace Auth {
	export type Options = {
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

		/** Redirect URLs after authentication */
		readonly redirect: {
			/** URL to redirect to after successful registration */
			readonly register: string | URL;

			/** URL to redirect to after successful login */
			readonly login: string | URL;
		};

		/** Credential storage and lookup callbacks */
		readonly credential: {
			/**
			 * Called after successful registration to store the credential.
			 * The credential data should be persisted for login verification.
			 *
			 * @param result - Registration result containing credentialId, publicKey, and userId
			 */
			readonly store: (result: Passkey.Verification) => Promise<void> | void;

			/**
			 * Lookup a stored credential by ID for login verification.
			 *
			 * @param credentialId - The credential ID from the authenticator
			 * @returns The stored credential with userId, or null if not found
			 */
			readonly get: (
				credentialId: string,
			) => Promise<Passkey.Credential | null> | Passkey.Credential | null;
		};
	};

	export type Session = {
		/** User ID */
		readonly userId: string;

		/** Session expiration time */
		readonly expiration: number;
	};
}

/**
 * Stateless authentication helper with passkey support.
 */
export class Auth {
	/** Cached auth keys in case of multiple App instances */
	static readonly #keys = new Map<string, Promise<CryptoKey>>();
	static readonly #cookieName = "__Host-auth-session";
	static readonly #hmac = "HMAC";

	/** Route actions */
	static readonly action = {
		register: "/_auth/register",
		login: "/_auth/login",
	};

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
			} satisfies Omit<Auth.Options, "secret" | "redirect" | "credential">,
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
		return `${payload}.${Codec.base64url.encode(
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
	 * @returns payload if valid, otherwise null
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
						Codec.base64url.decode(token.slice(dot + 1)), // signature
						Codec.encode(payload),
					)
				) {
					return payload;
				}
			} catch {}
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
						Codec.base64url.encode(Codec.encode(JSON.stringify(session))),
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

			if (payload) {
				const now = Date.now();
				const session = JSON.parse(
					Codec.decode(Codec.base64url.decode(payload)),
				) as Auth.Session;

				if (now < session.expiration) {
					// has not expired
					return session.expiration - now < this.options.refresh
						? // refresh
							this.#setCookie({
								...session,
								expiration: now + this.options.duration,
							})
						: // return as is
							session;
				}
			}
		} catch {}

		return this.logout();
	}

	/**
	 * @param userId user ID to login
	 * @returns new session
	 */
	login(userId: string) {
		return this.#setCookie({
			userId,
			expiration: Date.now() + this.options.duration,
		});
	}

	/** Logs out the user by expiring the session cookie */
	logout() {
		return this.#setCookie(null);
	}

	static #FormData = S.object({
		credential: S.object({ id: S.string() }),
		signed: S.string(),
	});

	/**
	 * @param c - Request context
	 * @returns Object with credential and options, or null if invalid
	 */
	static async #parseForm(c: Context) {
		const data = await c.form().data();

		return Auth.#FormData.parse({
			credential: JSON.parse(S.string().parse(data.get("credential"))),
			signed: data.get("signed"),
		});
	}

	/**
	 * @param options - Auth options with redirect configuration
	 * @returns Routes for passkey registration and login
	 */
	static routes(options: Auth.Options) {
		return [
			Route.post(Auth.action.register, async (c) => {
				const form = await Auth.#parseForm(c);

				const verification = await c.auth.passkey.verify(
					form.credential,
					form.signed,
				);

				// user callback to store the credential
				await options.credential.store(verification);

				await c.auth.login(verification.userId);

				c.redirect(options.redirect.register, 303);
			}),
			Route.post(Auth.action.login, async (c) => {
				const form = await Auth.#parseForm(c);

				// user callback to get the stored credential
				const stored = await options.credential.get(form.credential.id);
				if (!stored) throw new Error("Credential not found");

				await c.auth.passkey.assert(form.credential, form.signed, stored);

				await c.auth.login(stored.userId);

				c.redirect(options.redirect.login, 303);
			}),
		];
	}
}
