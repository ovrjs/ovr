import { type Context as ContextType, agent } from "../context/index.js";
import { Codec, Time } from "../util/index.js";
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
		const now = Date.now();
		if (
			session &&
			session.id === id &&
			session.expiration > now &&
			session.started + this.options.lifetime > now
		)
			return this.#renew(session, now);
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
		const expiration = Math.min(now + idle, session.started + lifetime);
		// at most once a day, or each half of a shorter idle timeout
		const renewed = session.expiration - idle;
		if (
			now - renewed >= Math.min(Time.day, idle / 2) &&
			expiration > session.expiration
		) {
			await this.options.sessions.renew(session.id, expiration);
			return { id: session.id, user: session.user, expiration };
		}
		return {
			id: session.id,
			user: session.user,
			expiration: session.expiration,
		};
	}

	/** Read a non-expired, non-revoked session, renewing it while it is used. */
	session() {
		// an agent's tool call, authorized by its token
		const { req } = this.#c as Partial<Pick<ContextType, "req">>;
		const call = req && agent.get(req);
		if (call?.session)
			return (this.#session ??= Promise.resolve(call.session as Auth.Session));

		// nobody is signed in on another host, its session cookie is not sent there
		if (this.#c.url.origin !== this.options.origin)
			return (this.#session ??= Promise.resolve(null));

		return (this.#session ??= this.#read());
	}

	/**
	 * Return to a local path after the next login, such as an agent's
	 * authorization request.
	 *
	 * @param path Local path with its query
	 */
	remember(path: string) {
		this.#origin();
		this.#c.cookie.set(State.#return, path, {
			secure: true,
			httpOnly: true,
			sameSite: "Lax",
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

		this.#c.cookie.set(State.#return, "", {
			secure: true,
			httpOnly: true,
			sameSite: "Lax",
			maxAge: 0,
		});

		return path.startsWith("/") &&
			!path.startsWith("//") &&
			!path.includes("\\")
			? path
			: fallback;
	}

	/** Replace the current session and issue a new signed, secure cookie. */
	async login(user: string) {
		this.#origin();
		if (
			typeof user !== "string" ||
			!user.trim() ||
			Codec.encode(user).length > 1024
		)
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
		this.#c.cookie.set(
			State.#cookie,
			await Token.seal(this.options.secret, "session", session.id),
			{
				secure: true,
				httpOnly: true,
				sameSite: "Lax",
				// renewals only change the record, so the cookie covers the lifetime
				maxAge: Math.floor(this.options.lifetime / Time.second),
			},
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
