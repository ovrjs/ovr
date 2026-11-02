import { Halt } from "../context/index.js";
import { Codec, Header, Mime, Time } from "../util/index.js";
import type { Auth } from "./index.js";
import { Issue } from "./issue.js";
import type { Storage } from "./storage.js";
import { Token } from "./token.js";

export namespace State {
	/** Session persistence and signing configuration used by internal request state. */
	export type Options = Pick<Auth.Options, "secret" | "origin" | "duration"> &
		Pick<Storage, "challenges" | "sessions">;
	/** Internal capabilities needed for request-local authentication state. */
	export type Context = Pick<Auth.Context, "url" | "cookie" | "res">;
}

/** Internal authentication state for exactly one service and request. */
export class State {
	static readonly #cookie = "__Host-auth-session";
	static readonly #binding = "__Host-auth-browser";
	readonly #c: State.Context;
	#browser: string | undefined;
	#session: Promise<Auth.Session | null> | undefined;

	/** Normalized authentication configuration. */
	readonly options;

	/** Create authentication helpers for the current request. */
	constructor(c: State.Context, options: State.Options) {
		if (c.url.origin !== options.origin) {
			// respond 421 and end the request, before any session read
			c.res.headers.set("cache-control", "no-store");
			c.res.headers.set(Header.name.type, Header.utf8(Mime.type.text));
			c.res.body = "Misdirected Request";
			c.res.status = 421;
			throw new Halt("Authentication requires its configured origin");
		}
		this.#c = c;
		this.options = { ...options, duration: options.duration ?? Time.week };
	}

	/** Read a browser binding; create it only while preparing a form in the handler. */
	browser(create = false) {
		this.#browser ??= this.#c.cookie.get(State.#binding);
		if (!this.#browser && create) {
			this.#browser = crypto.randomUUID();
			this.#c.cookie.set(State.#binding, this.#browser, {
				secure: true,
				httpOnly: true,
				sameSite: "Lax",
			});
		}
		return this.#browser;
	}

	#clear() {
		this.#c.res.headers.set("cache-control", "no-store");
		this.#c.cookie.set(State.#cookie, "", {
			secure: true,
			httpOnly: true,
			sameSite: "Lax",
			maxAge: 0,
		});
	}

	async #read() {
		this.#c.res.headers.set("cache-control", "no-store");
		const cookie = this.#c.cookie.get(State.#cookie);
		if (!cookie) return null;
		let id: string;
		try {
			id = await Token.open(this.options.secret, "session", cookie);
		} catch (e) {
			if (!(e instanceof Issue)) throw e;
			this.#clear();
			return null;
		}
		// Storage failures must propagate, rather than appear to be successful logouts.
		const session = await this.options.sessions.get(id);
		if (session && session.id === id && session.expiration > Date.now())
			return session;
		this.#clear();
		return null;
	}

	/** Read a non-expired, non-revoked session; does not extend its lifetime. */
	session() {
		return (this.#session ??= this.#read());
	}

	/** Replace the current session and issue a new signed, secure cookie. */
	async login(user: string) {
		if (
			typeof user !== "string" ||
			!user.trim() ||
			Codec.encode(user).length > 1024
		)
			throw new TypeError("Auth user ID must contain 1 to 1024 UTF-8 bytes");
		const previous = await this.session();
		if (previous) await this.options.sessions.delete(previous.id);
		const session = {
			id: crypto.randomUUID(),
			user,
			expiration: Date.now() + this.options.duration,
		};
		await this.options.sessions.set(session.id, session);
		this.#c.cookie.set(
			State.#cookie,
			await Token.seal(this.options.secret, "session", session.id),
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
	async revoke(id: string) {
		await this.options.sessions.delete(id);
		// A login earlier in this request may have replaced the incoming cookie's session.
		if (this.#session) {
			if ((await this.#session)?.id === id) {
				this.#clear();
				this.#session = Promise.resolve(null);
			}
			return;
		}
		const cookie = this.#c.cookie.get(State.#cookie);
		if (!cookie) return;
		try {
			if ((await Token.open(this.options.secret, "session", cookie)) !== id)
				return;
		} catch (error) {
			if (!(error instanceof Issue)) throw error;
			return;
		}
		this.#clear();
		this.#session = Promise.resolve(null);
	}

	/** Revoke the current session and expire its cookie. Always await this method. */
	async logout() {
		const session = await this.session();
		if (session) await this.options.sessions.delete(session.id);
		this.#clear();
		this.#session = Promise.resolve(null);
		return null;
	}
}
