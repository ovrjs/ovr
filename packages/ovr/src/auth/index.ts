import type { Context as ContextType } from "../context/index.js";
import type { JSX } from "../jsx/index.js";
import type { Route } from "../route/index.js";
import type { Form } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
import {
	type Configuration as ConfigurationType,
	configure,
} from "./configure.js";
import { State } from "./state.js";

export namespace Auth {
	/** Request capabilities required while preparing the built-in UI. */
	export type Context = Pick<ContextType, "url" | "cookie" | "res" | "form"> & {
		data: (options?: { payload: number }) => Promise<unknown>;
	};
	/** Complete ORM-independent passkey configuration. */
	export type Configuration<Shape extends Form.Shape> =
		ConfigurationType<Shape>;
	/** Request-scoped UI pieces with application field names preserved. */
	export interface Forms<Shape extends Form.Shape> {
		Register: Route.Form<string> & {
			Field: Form<Shape>["Field"];
			Fields: Form<Shape>["Fields"];
			Error: (props: JSX.IntrinsicElements["p"]) => JSX.Element;
		};
		Login: Route.Form<string> & {
			Error: (props: JSX.IntrinsicElements["p"]) => JSX.Element;
		};
		Logout: Route.Form<string>;
	}

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
		/** Store until expiration. Return false when shared storage capacity is exhausted. */
		set(id: string, challenge: Challenge): Result<void | boolean>;
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

	/** Database-backed authentication configuration; all instances must share persistence. */
	export interface Options {
		/** Random signing secret with at least 32 UTF-8 bytes. */
		readonly secret: string;
		/** Trusted HTTPS origin, for example `https://example.com`. */
		readonly origin: string;
		/** Required persistence for atomic, single-use challenges. */
		readonly challenges: Challenges;
		/** Required persistence for revocable sessions. */
		readonly sessions: Sessions;
		/** Display name shown by passkey providers; defaults to the origin hostname. */
		readonly name?: string;
		/** Session lifetime in milliseconds; defaults to one week, without sliding refresh. */
		readonly duration?: number;
		/** Browser prompt timeout; server verification allows an additional minute. Defaults to 60 seconds. */
		readonly timeout?: number;
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
		 * Return true when the snapshot matches, even when the values are unchanged.
		 * Use matched rows (or RETURNING), not changed-row counts. Return false for a
		 * concurrent change or deletion; never recreate a deleted passkey.
		 */
		update(credential: Credential, previous: Credential): Result<boolean>;
	}
}

/** Complete passkey authentication with application-owned persistence. */
export class Auth<Shape extends Form.Shape = Form.Shape> {
	readonly #options;
	readonly #states = new WeakMap<object, State>();

	/** Generated endpoints; App mounts them automatically. */
	readonly routes: readonly Route[];
	/** Prepare request-scoped UI in the handler before returning JSX. */
	readonly forms: (
		c: Auth.Context,
		props?: { nonce?: string },
	) => Auth.Forms<Shape>;

	/** Configure passkeys, session helpers, and automatic authentication rate limits. */
	constructor(options: Auth.Configuration<Shape>) {
		const origin = new URL(options.origin);
		if (origin.protocol !== "https:" || origin.origin !== options.origin)
			throw new TypeError("Auth origin must be an HTTPS origin without a path");
		if (Codec.encode(options.secret).length < 32)
			throw new TypeError("Auth secret must contain at least 32 bytes");
		for (const [name, value] of Object.entries({
			duration: options.duration ?? Time.week,
			timeout: options.timeout ?? Time.minute,
		})) {
			if (
				!Number.isSafeInteger(value) ||
				value < Time.second ||
				value > 365 * Time.day
			)
				throw new TypeError(
					`Auth ${name} must be a positive lifetime in milliseconds`,
				);
		}
		this.#options = { ...options };
		const service = configure(this.#options, (c) => this.#state(c));
		this.routes = service.routes;
		this.forms = service.forms;
	}

	/** Canonical HTTPS origin used by this service. */
	get origin() {
		return this.#options.origin;
	}

	#state(c: State.Context) {
		let state = this.#states.get(c);
		if (!state) {
			state = new State(c, this.#options);
			this.#states.set(c, state);
		}
		return state;
	}

	/** Read a session in the handler before returning streamed JSX. Does not extend its lifetime. */
	session(c: State.Context) {
		return this.#state(c).session();
	}

	/** Establish a session for an already-authorized user with a non-blank ID of at most 1024 UTF-8 bytes. Built-in passkey handlers do this automatically. */
	login(c: State.Context, id: string) {
		return this.#state(c).login(id);
	}

	/** Revoke the current session and expire its cookie. Always await this method. */
	logout(c: State.Context) {
		return this.#state(c).logout();
	}

	/** Revoke a selected session, also clearing this request's cookie when it matches. */
	revoke(c: State.Context, token: string) {
		return this.#state(c).revoke(token);
	}
}
