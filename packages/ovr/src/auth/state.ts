import { type Context as ContextType, agent } from "../context/index.js";
import { Codec, Time, noStore } from "../util/index.js";
import type { Auth } from "./index.js";
import { Issue } from "./issue.js";
import type { Storage } from "./storage.js";
import { Token } from "./token.js";

export namespace State {
	/** Session persistence and signing configuration used by internal request state. */
	export type Options = Pick<
		Auth.Options,
		"secret" | "origin" | "idle" | "lifetime"
	> &
		Pick<Storage, "challenges" | "sessions">;
	/** Internal capabilities needed for request-local authentication state. */
	export type Context = Pick<Auth.Context, "url" | "cookie" | "res">;
}

/** Internal authentication state for exactly one service and request. */
export class State {
	static readonly #cookie = "__Host-auth-session";
	static readonly #binding = "__Host-auth-browser";
	static readonly #return = "__Host-auth-return";
	readonly #c: State.Context;
	#browser: string | undefined;
	#session: Promise<Auth.Session | null> | undefined;

	/** Normalized authentication configuration. */
	readonly options;

	/** Create authentication helpers for the current request. */
	constructor(c: State.Context, options: State.Options) {
		this.#c = c;
		const lifetime = options.lifetime ?? 30 * Time.day;
		this.options = {
			...options,
			lifetime,
			// a session never outlives its lifetime, however recently it was used
			idle: Math.min(options.idle ?? Time.week, lifetime),
		};
	}

	/**
	 * A request on another host has no session there, its cookies are bound to
	 * Auth's origin, and passkeys cannot be used on it.
	 *
	 * @throws When the request is not on Auth's origin
	 */
	#origin() {
		if (this.#c.url.origin !== this.options.origin)
			throw new Error(
				`Auth serves ${this.options.origin}, this request is for ${this.#c.url.origin}`,
			);
	}

	/** Read a browser binding; create it only while preparing a form in the handler. */
	browser(create = false) {
		if (create) this.#origin();
		this.#browser ??= this.#c.cookie.get(State.#binding);
		if (!this.#browser && create) {
			this.#browser = crypto.randomUUID();
			this.#set(State.#binding, this.#browser);
		}
		return this.#browser;
	}

	/**
	 * Set one of Auth's cookies, which only its origin's server reads.
	 *
	 * @param name Cookie name
	 * @param value Cookie value
	 * @param options How long it lasts, a browser session without it
	 */
	#set(name: string, value: string, options?: { maxAge: number }) {
		this.#c.cookie.set(name, value, {
			secure: true,
			httpOnly: true,
			sameSite: "Lax",
			...options,
		});
	}

	#clear() {
		noStore(this.#c.res.headers);
		this.#set(State.#cookie, "", { maxAge: 0 });
	}

	async #read() {
		// an agent's tool call, authorized by its token
		const { req } = this.#c as Partial<Pick<ContextType, "req">>;
		const call = req && agent.get(req);
		if (call?.session) return call.session as Auth.Session;

		// nobody is signed in on another host, its session cookie is not sent there
		if (this.#c.url.origin !== this.options.origin) return null;

		noStore(this.#c.res.headers);
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
		const now = Date.now();
		if (
			session &&
			session.id === id &&
			session.expiration > now &&
			session.started + this.options.lifetime > now
		) {
			this.#started = session.started;
			return this.#renew(session, now);
		}
		this.#clear();
		return null;
	}

	/**
	 * Extend a session that is being used, up to its lifetime. Only the record
	 * changes: the cookie lasts the whole lifetime, so a renewal sets no header
	 * and works after the response has started streaming.
	 *
	 * @param session Valid stored session
	 * @param now Current time
	 * @returns The session with its current expiration
	 */
	async #renew(session: Storage.Session, now: number): Promise<Auth.Session> {
		const { idle, lifetime } = this.options;
		let { expiration } = session;
		const later = Math.min(now + idle, session.started + lifetime);
		// at most once a day, or each half of a shorter idle timeout
		const renewed = expiration - idle;
		if (now - renewed >= Math.min(Time.day, idle / 2) && later > expiration) {
			await this.options.sessions.renew(session.id, later);
			expiration = later;
		}
		return { id: session.id, user: session.user, expiration };
	}

	/** Read a non-expired, non-revoked session, renewing it while it is used. */
	session() {
		return (this.#session ??= this.#read());
	}

	/** When the browser's session signed in, once it is read */
	#started: number | undefined;

	/**
	 * @param within Milliseconds
	 * @returns `true` when the person signed in that recently, in this
	 * browser: what a session taken over later cannot say
	 */
	async recent(within: number) {
		await this.session();
		return this.#started !== undefined && Date.now() - this.#started <= within;
	}

	/**
	 * Return to a local path after the next login, such as an agent's
	 * authorization request, or the page that sent the user to log in. Any
	 * other path is ignored.
	 *
	 * @param path Local path with its query
	 */
	remember(path: string) {
		this.#origin();
		if (!State.#local(path)) return;
		this.#set(State.#return, path, {
			maxAge: Math.floor((15 * Time.minute) / Time.second),
		});
	}

	/**
	 * @param fallback Destination without a remembered path
	 * @returns The remembered path, cleared, or the fallback
	 */
	resume(fallback: string) {
		this.#origin();
		const path = this.#c.cookie.get(State.#return);
		if (!path) return fallback;

		this.#set(State.#return, "", { maxAge: 0 });

		return State.#local(path) ? path : fallback;
	}

	/**
	 * @param path Path from a request or a cookie
	 * @returns `true` for a path of this origin, which a browser cannot read as
	 * another host, short enough for a cookie
	 */
	static #local(path: string) {
		if (
			!path.startsWith("/") ||
			path.startsWith("//") ||
			path.includes("\\") ||
			path.length > 2048
		)
			return false;

		// as a browser reads it: it drops tabs and new lines, so `/\t/host` is
		// `//host`, another site
		const base = "https://local.invalid";
		try {
			return new URL(path, base).origin === base;
		} catch {
			return false;
		}
	}

	/** Replace the current session and issue a new signed, secure cookie. */
	async login(user: string) {
		this.#origin();
		if (!user.trim() || Codec.encode(user).length > 1024)
			throw new TypeError("Auth user ID must contain 1 to 1024 UTF-8 bytes");
		const previous = await this.session();
		if (previous) await this.options.sessions.delete(previous.id);
		const now = Date.now();
		const session = {
			id: crypto.randomUUID(),
			user,
			expiration: now + this.options.idle,
		};
		await this.options.sessions.set(session.id, { ...session, started: now });
		this.#set(
			State.#cookie,
			await Token.seal(this.options.secret, "session", session.id),
			// renewals only change the record, so the cookie covers the lifetime
			{ maxAge: Math.floor(this.options.lifetime / Time.second) },
		);
		this.#session = Promise.resolve(session);
		return session;
	}

	/** Revoke the current session and expire its cookie. Always await this method. */
	async logout() {
		this.#origin();
		const session = await this.session();
		if (session) await this.options.sessions.delete(session.id);
		this.#clear();
		this.#session = Promise.resolve(null);
		return null;
	}
}
