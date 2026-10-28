import type { Context } from "../context/index.js";
import { Codec, Time } from "../util/index.js";
import { AuthIssue } from "./issue.js";
import { Passkey } from "./passkey.js";

export namespace Auth {
	/** A synchronous or asynchronous storage result. */
	export type Result<T> = T | Promise<T>;

	/** Server-side state for one WebAuthn ceremony. */
	export interface Challenge {
		readonly challenge: string;
		readonly browser: string;
		readonly method: "register" | "login";
		readonly action: string;
		readonly origin: string;
		readonly expiration: number;
		readonly user?: string;
	}

	/** Challenge storage shared by all application instances. */
	export interface Challenges {
		/** Store until `expiration`; expired entries should be evicted. */
		set(id: string, challenge: Challenge): Result<void>;
		/** Atomically return and delete an entry; concurrent calls must have one winner. */
		take(id: string): Result<Challenge | null | undefined>;
	}

	/** A revocable session with a fixed lifetime. */
	export interface Session {
		/** User ID. */
		readonly id: string;
		/** Opaque session ID, usable with `auth.revoke()`. */
		readonly token: string;
		/** Absolute expiration time in milliseconds. */
		readonly expiration: number;
	}

	/** Session storage shared by all application instances. */
	export interface Sessions {
		/** Store a new session until its expiration. */
		set(token: string, session: Session): Result<void>;
		/** Return a session, or nothing if it has expired or been revoked. */
		get(token: string): Result<Session | null | undefined>;
		/** Revoke a session. */
		delete(token: string): Result<void>;
	}

	/** Authentication configuration; storage adapters must be shared across requests. */
	export interface Options {
		/** Random signing secret with at least 32 UTF-8 bytes. */
		readonly secret: string;
		/** Trusted HTTPS origin, for example `https://example.com`. */
		readonly origin: string;
		/** Atomic, single-use challenge storage. */
		readonly challenges: Challenges;
		/** Revocable session storage. */
		readonly sessions: Sessions;
		/** Display name shown by passkey providers; defaults to the origin hostname. */
		readonly name?: string;
		/** Session lifetime in milliseconds; defaults to one week, without sliding refresh. */
		readonly duration?: number;
	}

	/** Stored ES256 passkey, including state updated after each login. */
	export interface Credential {
		id: string;
		user: string;
		/** SPKI-encoded P-256 public key as base64url. */
		publicKey: string;
		counter: number;
		/** Whether the credential is eligible for backup; this must not change. */
		eligible: boolean;
		/** Current backup state, which may change. */
		backedUp: boolean;
	}

	/** Application-owned credential lookup and persistence. */
	export interface Credentials {
		find(id: string): Result<Credential | null | undefined>;
		/**
		 * Atomically save `credential` only if the record still matches `previous`.
		 * Return false for a concurrent change or deletion; never recreate a deleted passkey.
		 */
		update(credential: Credential, previous: Credential): Result<boolean>;
	}
}

/** Authentication with browser-bound passkeys and revocable sessions. */
export class Auth {
	static readonly #keys = new Map<string, Promise<CryptoKey>>();
	static readonly #cookie = "__Host-auth-session";
	static readonly #binding = "__Host-auth-browser";
	readonly #c: Pick<Context, "cookie" | "res">;
	#browser: string | undefined;
	#session: Promise<Auth.Session | null> | undefined;

	/** Normalized authentication configuration. */
	readonly options;
	/** Registration and login helpers. */
	readonly passkey: Passkey;

	/** Create authentication helpers for the current request. */
	constructor(c: Passkey.Context, options: Auth.Options) {
		const origin = new URL(options.origin);
		if (origin.protocol !== "https:" || origin.origin !== options.origin) {
			throw new TypeError("Auth origin must be an HTTPS origin without a path");
		}
		if (Codec.encode(options.secret).length < 32) {
			throw new TypeError("Auth secret must contain at least 32 bytes");
		}
		if (
			!Number.isSafeInteger(options.duration ?? Time.week) ||
			(options.duration ?? Time.week) < Time.second
		) {
			throw new TypeError(
				"Auth duration must be a positive lifetime in milliseconds",
			);
		}
		if (c.url.origin !== options.origin) throw new AuthIssue("origin");
		this.#c = c;
		this.options = { duration: Time.week, ...options };
		this.passkey = new Passkey(c, this);
	}

	get #key() {
		let key = Auth.#keys.get(this.options.secret);
		if (!key) {
			key = crypto.subtle.importKey(
				"raw",
				Codec.encode(this.options.secret),
				{ name: "HMAC", hash: "SHA-256" },
				false,
				["sign", "verify"],
			);
			Auth.#keys.set(this.options.secret, key);
		}
		return key;
	}

	/** Sign a payload for integrity; callers must separately enforce freshness and purpose. */
	async sign(payload: string) {
		return `${payload}.${Codec.Base64Url.encode(new Uint8Array(await crypto.subtle.sign("HMAC", await this.#key, Codec.encode(payload))))}`;
	}

	/** Verify integrity and return a signed payload. */
	async verify(token: string) {
		const dot = token.lastIndexOf(".");
		if (dot > 0) {
			const payload = token.slice(0, dot);
			try {
				if (
					await crypto.subtle.verify(
						"HMAC",
						await this.#key,
						Codec.Base64Url.decode(token.slice(dot + 1)),
						Codec.encode(payload),
					)
				)
					return payload;
			} catch {
				// Malformed signatures are authentication failures.
			}
		}
		throw new AuthIssue("token");
	}

	/** Read a browser binding; create it only while preparing a form in the handler. */
	browser(create = false) {
		this.#browser ??= this.#c.cookie.get(Auth.#binding);
		if (!this.#browser && create) {
			this.#browser = crypto.randomUUID();
			this.#c.cookie.set(Auth.#binding, this.#browser, {
				secure: true,
				httpOnly: true,
				sameSite: "Lax",
			});
		}
		return this.#browser;
	}

	#clear() {
		this.#c.res.headers.set("cache-control", "no-store");
		this.#c.cookie.set(Auth.#cookie, "", {
			secure: true,
			httpOnly: true,
			sameSite: "Lax",
			maxAge: 0,
		});
	}

	async #read() {
		this.#c.res.headers.set("cache-control", "no-store");
		const cookie = this.#c.cookie.get(Auth.#cookie);
		if (!cookie) return null;
		let token: string;
		try {
			const payload = await this.verify(cookie);
			if (!payload.startsWith("session:")) throw new AuthIssue("session");
			token = payload.slice(8);
		} catch (e) {
			if (!(e instanceof AuthIssue)) throw e;
			this.#clear();
			return null;
		}
		// Storage failures must propagate, rather than appear to be successful logouts.
		const session = await this.options.sessions.get(token);
		if (session && session.token === token && session.expiration > Date.now())
			return session;
		this.#clear();
		return null;
	}

	/** Read a non-expired, non-revoked session; does not extend its lifetime. */
	session() {
		return (this.#session ??= this.#read());
	}

	/** Replace the current session and issue a new signed, secure cookie. */
	async login(id: string) {
		const previous = await this.session();
		if (previous) await this.options.sessions.delete(previous.token);
		const session = {
			id,
			token: crypto.randomUUID(),
			expiration: Date.now() + this.options.duration,
		};
		await this.options.sessions.set(session.token, session);
		this.#c.cookie.set(
			Auth.#cookie,
			await this.sign(`session:${session.token}`),
			{
				secure: true,
				httpOnly: true,
				sameSite: "Lax",
				maxAge: Math.floor(this.options.duration / Time.second),
			},
		);
		this.#session = Promise.resolve(session);
		return session;
	}

	/** Revoke a session by its opaque ID. */
	async revoke(token: string) {
		await this.options.sessions.delete(token);
		if ((await this.#session)?.token === token) {
			this.#clear();
			this.#session = Promise.resolve(null);
		}
	}

	/** Revoke the current session and expire its cookie. Always await this method. */
	async logout() {
		const session = await this.session();
		if (session) await this.options.sessions.delete(session.token);
		this.#clear();
		this.#session = Promise.resolve(null);
		return null;
	}
}
