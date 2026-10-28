import type { Context as ContextType } from "../context/index.js";
import { jsx } from "../jsx/index.js";
import { Render } from "../render/index.js";
import { Route } from "../route/index.js";
import { Field, Form, Schema } from "../schema/index.js";
import { Codec, Time } from "../util/index.js";
import { AuthData } from "./auth-data.js";
import { CBOR, COSE } from "./cbor.js";
import { listen } from "./client.js";
import { DER } from "./der.js";
import type { Auth } from "./index.js";
import { AuthIssue } from "./issue.js";

export namespace Passkey {
	/** Request capabilities needed by authentication helpers. */
	export type Context = Pick<ContextType, "cookie" | "url" | "res" | "form"> & {
		data: () => Promise<unknown>;
	};
	/** POST route contract retaining typed pathname parameters. */
	export interface Post<Pattern extends string> extends Omit<
		Route.Post,
		"url" | "pathname"
	> {
		pattern: Pattern;
		Form: Route.Form<Pattern>;
		url: Route<Pattern>["url"];
		pathname(params?: Record<string, string>): string;
	}
	/** Registration form configuration. */
	export interface Options {
		/** Opaque user handle, at most 64 UTF-8 bytes; defaults to a UUID. Never use an email. */
		readonly user?: string;
		/** Credential IDs already associated with this user. */
		readonly exclude?: string[];
	}
}

/** ES256 passkeys with single-use, browser-bound ceremonies. */
export class Passkey {
	static readonly #ttl = Time.minute;
	static readonly #routes = new WeakSet<object>();
	static readonly #fields = new Form({
		credential: Field.hidden().json(Schema.unknown()),
		challenge: Field.hidden(),
	});
	static readonly #payload = Schema.object({
		credential: Schema.unknown(),
		challenge: Schema.string(),
	});
	static readonly #bootstrap = Schema.object({
		method: Schema.union([Schema.literal("register"), Schema.literal("login")]),
		action: Schema.string(),
		origin: Schema.string(),
		browser: Schema.string(),
		expiration: Schema.number().int(),
		user: Schema.string().optional(),
		exclude: Schema.array(Schema.string()).optional(),
	});
	static readonly #credential = Schema.object({
		type: Schema.literal("public-key"),
		id: Schema.string(),
		rawId: Schema.string(),
	});
	static readonly #registration = Passkey.#credential.extend({
		response: Schema.object({
			clientDataJSON: Schema.string(),
			attestationObject: Schema.string(),
		}),
	});
	static readonly #assertion = Passkey.#credential.extend({
		response: Schema.object({
			clientDataJSON: Schema.string(),
			authenticatorData: Schema.string(),
			signature: Schema.string(),
			userHandle: Schema.union([Schema.string(), Schema.literal(null)]),
		}),
	});
	readonly #c: Passkey.Context;
	readonly #auth: Auth;
	readonly #rp: string;

	/** Create request-scoped passkey helpers. */
	constructor(c: Passkey.Context, auth: Auth) {
		this.#c = c;
		this.#auth = auth;
		this.#rp = new URL(auth.options.origin).hostname;
	}

	/** Registration form creation and response verification. */
	readonly register = {
		/** Create a form component; call in the route handler before returning JSX. */
		form: <Pattern extends string>(
			route: Passkey.Post<Pattern>,
			{ user = crypto.randomUUID(), exclude = [] }: Passkey.Options = {},
		) => {
			if (!Codec.encode(user).length || Codec.encode(user).length > 64)
				throw new TypeError("Passkey user must contain 1–64 UTF-8 bytes");
			return this.#form(route, "register", { user, exclude });
		},
		/** Verify registration; persist the credential with a unique ID constraint. */
		verify: () => this.#register(),
	};

	/** Username-free login form creation and response verification. */
	readonly login = {
		/** Create a form component; call in the route handler before returning JSX. */
		form: <Pattern extends string>(route: Passkey.Post<Pattern>) =>
			this.#form(route, "login"),
		/** Verify an assertion and atomically persist its counter and backup state. */
		verify: (credentials: Auth.Credentials) => this.#login(credentials),
	};

	#form<Pattern extends string>(
		route: Passkey.Post<Pattern>,
		method: "register" | "login",
		options: Passkey.Options = {},
	): Route.Form<Pattern> {
		this.#origin();
		if (route.extend && !Passkey.#routes.has(route)) {
			if (route.names?.some((v) => v === "credential" || v === "challenge"))
				throw new TypeError(
					"Passkey forms reserve credential and challenge fields",
				);
			Object.assign(route, route.extend(Passkey.#fields));
			Passkey.#routes.add(route);
		}
		const browser = this.#auth.browser(true);
		this.#c.res.headers.set("cache-control", "no-store");
		return (props) => {
			const id = `passkey-${crypto.randomUUID()}`;
			return route.Form({
				...props,
				children: [
					props.children ?? [
						route.Fields?.(),
						jsx("button", {
							children: method === "register" ? "Register" : "Log in",
						}),
					],
					jsx("p", { role: "status", "aria-live": "polite" }),
					jsx("script", {
						id,
						type: "module",
						children: async () =>
							Render.html(
								`(${listen})(${[
									id,
									await this.#auth.sign(
										`passkey:${JSON.stringify({ method, action: route.pathname(props.params), origin: this.#auth.options.origin, browser, expiration: Date.now() + Time.hour, ...options })}`,
									),
									Passkey.options.url(),
									method,
								]
									.map((v) =>
										JSON.stringify(v).replace(
											/[<>&\u2028\u2029]/g,
											(c) =>
												`\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
										),
									)
									.join()})`,
							),
					}),
					jsx("noscript", {
						children: "JavaScript is required for authentication.",
					}),
				],
			});
		};
	}

	#origin() {
		if (this.#c.url.origin !== this.#auth.options.origin)
			throw new AuthIssue("origin");
	}

	/** Fresh options endpoint, mounted by App when authentication is configured. */
	static readonly options = Route.post(
		"/_ovr/passkey/options",
		{ bootstrap: Field.text() },
		async (c) => {
			const input = await c.data();
			if (input.issues) throw input;
			const payload = await c.auth.verify(input.data.bootstrap);
			if (!payload.startsWith("passkey:")) throw new AuthIssue("bootstrap");
			const result = Schema.string()
				.json(Passkey.#bootstrap)
				.parse(payload.slice(8));
			if (result.issues) throw result;
			const bootstrap = result.data;
			if (
				c.url.origin !== c.auth.options.origin ||
				bootstrap.origin !== c.auth.options.origin
			)
				throw new AuthIssue("origin");
			if (!c.auth.browser() || bootstrap.browser !== c.auth.browser())
				throw new AuthIssue("browser");
			if (bootstrap.expiration <= Date.now())
				throw new AuthIssue("bootstrap (expired)");
			if (
				bootstrap.method === "register" &&
				(!bootstrap.user || Codec.encode(bootstrap.user).length > 64)
			)
				throw new AuthIssue("user");

			const id = crypto.randomUUID();
			const challenge = Codec.Base64Url.encode(
				crypto.getRandomValues(new Uint8Array(32)),
			);
			await c.auth.options.challenges.set(id, {
				challenge,
				browser: bootstrap.browser,
				method: bootstrap.method,
				action: bootstrap.action,
				origin: bootstrap.origin,
				expiration: Date.now() + Passkey.#ttl,
				...(bootstrap.user ? { user: bootstrap.user } : {}),
			});
			const rp = new URL(c.auth.options.origin).hostname;
			c.res.headers.set("cache-control", "no-store");
			if (bootstrap.method === "register") {
				c.json({
					challenge: id,
					options: {
						challenge,
						rp: { id: rp, name: c.auth.options.name ?? rp },
						user: {
							id: Codec.Base64Url.encode(Codec.encode(bootstrap.user!)),
							name: bootstrap.user!,
							displayName: bootstrap.user!,
						},
						pubKeyCredParams: [{ type: "public-key", alg: -7 }],
						excludeCredentials: (bootstrap.exclude ?? []).map((id) => ({
							type: "public-key",
							id,
						})),
						authenticatorSelection: {
							residentKey: "required",
							requireResidentKey: true,
							userVerification: "required",
						},
						timeout: Passkey.#ttl,
						attestation: "none",
					} satisfies PublicKeyCredentialCreationOptionsJSON,
				});
			} else {
				c.json({
					challenge: id,
					options: {
						challenge,
						rpId: rp,
						timeout: Passkey.#ttl,
						userVerification: "required",
					} satisfies PublicKeyCredentialRequestOptionsJSON,
				});
			}
		},
	);

	static #decode(value: string) {
		if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1)
			throw new AuthIssue("base64url");
		const bytes = Codec.Base64Url.decode(value);
		if (Codec.Base64Url.encode(bytes) !== value)
			throw new AuthIssue("base64url");
		return bytes;
	}

	static async #hash(value: Uint8Array<ArrayBuffer>) {
		return new Uint8Array(await crypto.subtle.digest("SHA-256", value));
	}

	static async #key(value: Uint8Array<ArrayBuffer>) {
		try {
			return await crypto.subtle.importKey(
				"spki",
				value,
				{ name: "ECDSA", namedCurve: "P-256" },
				false,
				["verify"],
			);
		} catch (e) {
			if (e instanceof DOMException) throw new AuthIssue("public key");
			throw e;
		}
	}

	async #consume(method: "register" | "login") {
		this.#origin();
		const parsed = await this.#c.data();
		// Schema routes cache their parsed body; routes without a schema use the raw form.
		const result =
			parsed == null
				? await Passkey.#fields.parse(this.#c.form())
				: Passkey.#payload.parse(
						parsed && typeof parsed === "object" && "data" in parsed
							? parsed.data
							: undefined,
					);
		if (result.issues) throw result;
		const state = await this.#auth.options.challenges.take(
			result.data.challenge,
		);
		if (!state || state.expiration <= Date.now())
			throw new AuthIssue("challenge (expired or consumed)");
		if (!this.#auth.browser() || state.browser !== this.#auth.browser())
			throw new AuthIssue("browser");
		if (
			state.origin !== this.#auth.options.origin ||
			state.method !== method ||
			state.action !== this.#c.url.pathname
		)
			throw new AuthIssue("challenge binding");
		return { state, credential: result.data.credential };
	}

	async #client(value: string, state: Auth.Challenge) {
		const result = Schema.string()
			.json(
				Schema.object({
					type: Schema.literal(
						state.method === "register" ? "webauthn.create" : "webauthn.get",
					),
					origin: Schema.literal(this.#auth.options.origin),
					challenge: Schema.literal(state.challenge),
					crossOrigin: Schema.literal(false).optional(),
				}),
			)
			.parse(Codec.decode(Passkey.#decode(value)));
		if (result.issues) throw result;
	}

	async #data(data: AuthData.Data) {
		if (
			!Passkey.#equal(
				data.rpIdHash,
				await Passkey.#hash(Codec.encode(this.#rp)),
			)
		)
			throw new AuthIssue("RP ID");
		if (!(data.flags & 1) || !(data.flags & 4)) throw new AuthIssue("user");
		if (data.flags & 16 && !(data.flags & 8))
			throw new AuthIssue("backup flags");
	}

	static #equal(a: Uint8Array, b: Uint8Array) {
		if (a.length !== b.length) return false;
		let result = 0;
		for (let i = 0; i < a.length; i++) result |= a[i]! ^ b[i]!;
		return result === 0;
	}

	async #register() {
		const { state, credential } = await this.#consume("register");
		const result = Passkey.#registration.parse(credential);
		if (result.issues) throw result;
		await this.#client(result.data.response.clientDataJSON, state);
		const data = AuthData.parse(
			new CBOR(
				Passkey.#decode(result.data.response.attestationObject),
			).decodeAttestation(),
		);
		await this.#data(data);
		if (!data.attestedCredentialData || !state.user)
			throw new AuthIssue("credential data");
		const id = data.attestedCredentialData.credentialId;
		if (
			!Passkey.#equal(Passkey.#decode(result.data.id), id) ||
			!Passkey.#equal(Passkey.#decode(result.data.rawId), id)
		)
			throw new AuthIssue("credential ID");
		const key = COSE.toSPKI(data.attestedCredentialData.publicKey);
		// Web Crypto validates that the P-256 point is on the curve before it is stored.
		await Passkey.#key(key);
		return {
			id: result.data.id,
			user: state.user,
			publicKey: Codec.Base64Url.encode(key),
			counter: data.counter,
			eligible: Boolean(data.flags & 8),
			backedUp: Boolean(data.flags & 16),
		};
	}

	async #login(credentials: Auth.Credentials) {
		const { state, credential } = await this.#consume("login");
		const result = Passkey.#assertion.parse(credential);
		if (result.issues) throw result;
		await this.#client(result.data.response.clientDataJSON, state);
		if (
			!Passkey.#equal(
				Passkey.#decode(result.data.id),
				Passkey.#decode(result.data.rawId),
			)
		)
			throw new AuthIssue("credential ID");
		const stored = await credentials.find(result.data.id);
		if (!stored || stored.id !== result.data.id)
			throw new AuthIssue("credential");
		if (
			!result.data.response.userHandle ||
			!Passkey.#equal(
				Passkey.#decode(result.data.response.userHandle),
				Codec.encode(stored.user),
			)
		)
			throw new AuthIssue("user handle");
		const bytes = Passkey.#decode(result.data.response.authenticatorData);
		const data = AuthData.parse(bytes);
		await this.#data(data);
		if (data.attestedCredentialData) throw new AuthIssue("assertion flags");
		if (Boolean(data.flags & 8) !== stored.eligible)
			throw new AuthIssue("backup eligibility");
		if (
			!Number.isSafeInteger(stored.counter) ||
			stored.counter < 0 ||
			((stored.counter || data.counter) && data.counter <= stored.counter)
		)
			throw new AuthIssue("signature counter");
		const hash = await Passkey.#hash(
			Passkey.#decode(result.data.response.clientDataJSON),
		);
		const signed = new Uint8Array(bytes.length + hash.length);
		signed.set(bytes);
		signed.set(hash, bytes.length);
		const key = await Passkey.#key(Passkey.#decode(stored.publicKey));
		const signature = DER.unwrap(
			Passkey.#decode(result.data.response.signature),
		);
		if (
			!(await crypto.subtle.verify(
				{ name: "ECDSA", hash: "SHA-256" },
				key,
				signature,
				signed,
			))
		)
			throw new AuthIssue("signature");
		const updated = {
			...stored,
			counter: data.counter,
			backedUp: Boolean(data.flags & 16),
		};
		if (!(await credentials.update(updated, stored)))
			throw new AuthIssue("credential changed");
		return updated;
	}
}
