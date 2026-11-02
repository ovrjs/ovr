import type { Context as ContextType } from "../context/index.js";
import type { Database } from "../database/index.js";
import type { JSX } from "../jsx/index.js";
import { Limiter } from "../limiter/index.js";
import type { Route } from "../route/index.js";
import type { Form } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
import { configure } from "./configure.js";
import { Issue } from "./issue.js";
import { State } from "./state.js";
import { Storage } from "./storage.js";

type Result<T> = T | Promise<T>;

export namespace Auth {
	/** Authentication validation issue. */
	export type Issue = InstanceType<typeof Auth.Issue>;

	/** Request capabilities required while preparing the built-in UI. */
	export type Context = Pick<ContextType, "url" | "cookie" | "res" | "form"> & {
		data: (options?: { payload: number }) => Promise<unknown>;
	};
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

	/** Rate limit policy, Auth creates the `Limiter` with its database. */
	export type Limit = Omit<Limiter.Options, "database" | "error">;

	/** A revocable session with a fixed lifetime. */
	export interface Session {
		/** Opaque session ID, usable with `auth.revoke()`. */
		readonly id: string;
		/** User ID. */
		readonly user: string;
		/** Absolute expiration time in milliseconds. */
		readonly expiration: number;
	}

	/** Authentication configuration; all instances share the database. */
	export interface Options<Shape extends Form.Shape = Form.Shape> {
		/** Signing secret(s), each at least 32 UTF-8 bytes. Seal with the first; accept all during rotation. */
		readonly secret: string | readonly [string, ...string[]];
		/** Trusted HTTPS origin, for example `https://example.com`. */
		readonly origin: string;
		/** Database containing `Auth.tables`, which stores challenges, sessions, credentials, and rate limits. */
		readonly database: Database;
		/** Session lifetime in milliseconds; defaults to one week, without sliding refresh. */
		readonly duration?: number;
		/** Registration fields, provider labels, and account creation. */
		readonly register: {
			/** Application fields, validated before prompting and again before saving. */
			readonly fields: Shape;
			/** Human-readable account label, independent of the opaque user handle. */
			readonly name: (data: Form.Parse.Data<Shape>) => Result<string>;
			/** Insert the account with `t`, in the transaction that stores its first credential. Never upsert an existing user. */
			readonly create: (
				t: Database.Transaction,
				data: Form.Parse.Data<Shape>,
				user: string,
			) => Result<void>;
		};
		/** Authentication page, also used for generic failure redirects. Defaults to /login. */
		readonly page?: string;
		/** Destination after registration or login. Defaults to /. */
		readonly redirect?: string;
		/** Override the default endpoint paths. Paths must be distinct literal local paths. */
		readonly paths?: Partial<Record<"register" | "login" | "logout", string>>;
		/** Additional and changed rate limits, stored in `database`; ovr supplies the signup and sign-in policies. */
		readonly limits?: {
			/** Optional generous request ceiling before client key creation. Counts invalid fields and requests denied by later policies too. */
			readonly guard?: Auth.Limit;
			/** Additional shared policies checked after the client policy, preserving the built-in defaults. */
			readonly extra?: readonly Auth.Limit[];
			/** Change the built-in registration client policy, 5 per 10 minutes; invalid options fields do not consume it. */
			readonly register?: Auth.Limit;
			/** Change the built-in login client policy, 20 per minute. */
			readonly login?: Auth.Limit;
		};
		/** Receive detailed failures for server-side logging. Details are never sent to the browser. */
		readonly error?: (
			error: unknown,
			c: Pick<ContextType, "req" | "url" | "cookie" | "ip">,
		) => Result<void>;
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
}

/** Complete passkey authentication stored in the application's Postgres database. */
export class Auth<Shape extends Form.Shape = Form.Shape> {
	/** Validation issue shared by authentication and passkey verification. */
	static readonly Issue = Issue;

	/** Tables Auth stores its data in, include them in the database's tables. */
	static readonly tables = [
		Storage.credentials,
		Storage.sessions,
		Storage.challenges,
		Limiter.table,
	] as const;

	readonly #options: State.Options;
	readonly #states = new WeakMap<object, State>();

	/** Generated endpoints; App mounts them automatically. */
	readonly routes: readonly Route[];
	/** Prepare request-scoped UI in the handler before returning JSX. */
	readonly forms: (
		c: Auth.Context,
		props?: { nonce?: string },
	) => Auth.Forms<Shape>;

	/** Configure passkeys, session helpers, and automatic authentication rate limits. */
	constructor(options: Auth.Options<Shape>) {
		const origin = new URL(options.origin);
		if (origin.protocol !== "https:" || origin.origin !== options.origin)
			throw new TypeError("Auth origin must be an HTTPS origin without a path");
		const secrets =
			typeof options.secret === "string"
				? [options.secret]
				: [...options.secret];
		if (
			!secrets.length ||
			secrets.some(
				(secret) =>
					typeof secret !== "string" || Codec.encode(secret).length < 32,
			)
		)
			throw new TypeError("Auth secret must contain at least 32 bytes");
		if (
			options.duration !== undefined &&
			(!Number.isSafeInteger(options.duration) ||
				options.duration < Time.second ||
				options.duration > 365 * Time.day)
		)
			throw new TypeError(
				"Auth duration must be a positive lifetime in milliseconds",
			);
		if (typeof options.database?.transaction !== "function")
			throw new TypeError("Auth requires a database");
		const storage = Storage.of(options.database);
		this.#options = {
			origin: options.origin,
			secret:
				typeof options.secret === "string"
					? options.secret
					: [options.secret[0], ...options.secret.slice(1)],
			...(options.duration === undefined ? {} : { duration: options.duration }),
			challenges: storage.challenges,
			sessions: storage.sessions,
		};
		const service = configure(options, storage, (c) => this.#state(c));
		this.routes = service.routes;
		this.forms = service.forms;
	}

	/** Canonical HTTPS origin used by this service. */
	get origin() {
		return this.#options.origin;
	}

	#state(c: State.Context) {
		return this.#states.getOrInsertComputed(
			c,
			() => new State(c, this.#options),
		);
	}

	/** Read a session in the handler before returning streamed JSX. Does not extend its lifetime. */
	session(c: Pick<Auth.Context, "url" | "cookie" | "res">) {
		return this.#state(c).session();
	}

	/** Establish a session for an already-authorized user with a non-blank ID of at most 1024 UTF-8 bytes. Built-in passkey handlers do this automatically. */
	login(c: Pick<Auth.Context, "url" | "cookie" | "res">, user: string) {
		return this.#state(c).login(user);
	}

	/** Revoke the current session and expire its cookie. Always await this method. */
	logout(c: Pick<Auth.Context, "url" | "cookie" | "res">) {
		return this.#state(c).logout();
	}

	/** Revoke a selected session, also clearing this request's cookie when it matches. */
	revoke(c: Pick<Auth.Context, "url" | "cookie" | "res">, id: string) {
		return this.#state(c).revoke(id);
	}
}
