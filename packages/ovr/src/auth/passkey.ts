import type { Context as ContextType } from "../context/index.js";
import { type JSX, jsx } from "../jsx/index.js";
import { Route } from "../route/index.js";
import { Field, Form, Schema } from "../schema/index.js";
import { Codec, Size, Time } from "../util/index.js";
import { AuthData } from "./auth-data.js";
import { CBOR, COSE } from "./cbor.js";
import { etag, source } from "./client-source.js";
import { DER } from "./der.js";
import type { Auth } from "./index.js";
import { Issue } from "./issue.js";
import type { State } from "./state.js";
import type { Storage } from "./storage.js";
import { Token } from "./token.js";

export namespace Passkey {
	/**
	 * Composable authentication form with an accessible error component.
	 *
	 * @template Pattern Pattern of the route the form submits to
	 */
	export type Component<Pattern extends string> = Route.Form<Pattern> & {
		Error: (props: JSX.IntrinsicElements["p"]) => JSX.Element;
	};
	/**
	 * POST route contract retaining typed pathname parameters.
	 *
	 * @template Pattern Route pattern
	 */
	export interface Post<Pattern extends string> extends Pick<
		Route.Post,
		"Fields" | "extend" | "names"
	> {
		pattern: Pattern;
		Form: Route.Form<Pattern>;
		url: Route<Pattern>["url"];
	}
	/** Internal form configuration. */
	export interface Options {
		/** Fresh options URL; supplied by the configured handlers. */
		readonly endpoint: string;
		/** CSP nonce for strict nonce policies. */
		readonly nonce?: string;
		/** Form fields the ceremony is for, from `Passkey.fields`, checked when it starts. */
		readonly fields?: string;
	}
}

/** ES256 passkeys with single-use, browser-bound ceremonies. */
export class Passkey {
	static readonly #routes = new WeakSet<object>();
	static readonly #fields = new Form({
		credential: Field.hidden().json(Schema.unknown()),
		ceremony: Field.hidden(),
	});
	static readonly #payload = Schema.object({
		credential: Schema.unknown(),
		ceremony: Schema.string(),
	});
	static readonly #bootstrap = Schema.object({
		method: Schema.union([Schema.literal("register"), Schema.literal("login")]),
		action: Schema.string(),
		origin: Schema.string(),
		browser: Schema.string(),
		expiration: Schema.number().int(),
		user: Schema.string().optional(),
		fields: Schema.string().optional(),
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
			// browsers leave it out, rather than send null, when there is none
			userHandle: Schema.union([
				Schema.string(),
				Schema.literal(null),
			]).optional(),
		}),
	});
	readonly #c: Auth.Context;
	readonly #auth: State;

	/** Create request-scoped passkey helpers. */
	constructor(c: Auth.Context, auth: State) {
		this.#c = c;
		this.#auth = auth;
	}

	/**
	 * Complete a passkey POST schema at startup, before mounting it in an App.
	 *
	 * @template T Passkey POST route
	 */
	static prepare<T extends Pick<Passkey.Post<string>, "extend" | "names">>(
		route: T,
	) {
		if (!Passkey.#routes.has(route)) {
			if (route.extend) Object.assign(route, route.extend(Passkey.#fields));
			Passkey.#routes.add(route);
		}
		return route;
	}

	/**
	 * Create a form in the handler before returning JSX.
	 *
	 * @template Pattern Pattern of the route the form submits to
	 */
	form<Pattern extends string>(
		route: Passkey.Post<Pattern>,
		method: "register" | "login",
		options: Passkey.Options,
	) {
		this.#origin();
		const browser = this.#auth.browser(true);
		const user = method === "register" ? crypto.randomUUID() : undefined;
		this.#c.res.headers.set("cache-control", "no-store");
		const Form: Passkey.Component<Pattern> = Object.assign(
			(props: Parameters<Route.Form<Pattern>>[0]) =>
				route.Form({
					...props,
					children: [
						props.children ?? [
							route.Fields?.(),
							jsx("button", {
								children: method === "register" ? "Create account" : "Log in",
							}),
						],
						// A supplied Error component takes precedence over this accessible fallback.
						Form.Error({ "data-passkey-fallback": true }),
						async () =>
							jsx("script", {
								id: `passkey-${crypto.randomUUID()}`,
								type: "module",
								src: Passkey.client.url(),
								nonce: options.nonce,
								"data-passkey": method,
								"data-endpoint": options.endpoint,
								"data-bootstrap": await Token.seal(
									this.#auth.options.secret,
									"passkey",
									JSON.stringify({
										method,
										// the form's own params, checked by its props type
										action: route.url({ params: props.params } as never),
										origin: this.#auth.options.origin,
										browser,
										expiration: Date.now() + Time.hour,
										user,
										fields: options.fields,
									}),
								),
							}),
						jsx("noscript", {
							children: "JavaScript is required for authentication.",
						}),
					],
				}),
			{
				Error: (props: JSX.IntrinsicElements["p"]) =>
					jsx("p", {
						role: "status",
						"aria-live": "polite",
						...props,
						"data-passkey-error": true,
					}),
			},
		);
		return Form;
	}

	/** Dependency-free browser module, served as a normal same-origin JavaScript resource. */
	static readonly client = Route.get("/_passkey/client.js").use((c) => {
		c.res.headers.set("content-type", "text/javascript; charset=utf-8");
		c.res.headers.set("x-content-type-options", "nosniff");
		c.res.headers.set("cache-control", "no-cache");
		c.res.headers.set("etag", etag);
		if (
			c.req.headers
				.get("if-none-match")
				?.split(",")
				.some(
					(value) =>
						value.trim() === "*" ||
						value.trim().replace(/^W\//, "") === etag.slice(2),
				)
		) {
			c.res.status = 304;
			c.res.body = null;
			return;
		}
		c.res.body = source;
	});

	#origin() {
		if (this.#c.url.origin !== this.#auth.options.origin)
			throw new Issue("origin");
	}

	/** Validate a signed form and issue one fresh ceremony. */
	static async issue(
		c: Pick<ContextType, "url" | "res" | "text" | "json">,
		auth: State,
		token: string,
		label: (() => string | Promise<string>) | undefined,
		expected: {
			method: "register" | "login";
			action: string;
			fields?: string;
			/** Credential IDs a login is limited to, for a user already known */
			allow?: readonly string[];
		},
	) {
		const result = Schema.string()
			.json(Passkey.#bootstrap)
			.parse(await Token.open(auth.options.secret, "passkey", token));
		if (result.issues) throw new Issue("bootstrap");
		const bootstrap = result.data;
		if (
			c.url.origin !== auth.options.origin ||
			bootstrap.origin !== auth.options.origin
		)
			throw new Issue("origin");
		if (
			!auth.browser() ||
			bootstrap.browser !== auth.browser() ||
			bootstrap.expiration <= Date.now()
		)
			return c.text("This page has expired. Reload and try again.", 410);
		if (
			bootstrap.method !== expected.method ||
			bootstrap.action !== expected.action ||
			// a page made for some fields, such as one consent request, starts only their ceremony
			(bootstrap.fields !== undefined && bootstrap.fields !== expected.fields)
		)
			throw new Issue("bootstrap binding");
		if (
			bootstrap.method === "register" &&
			(!bootstrap.user || Codec.encode(bootstrap.user).length > 64)
		)
			throw new Issue("user");
		const rp = new URL(auth.options.origin).hostname;
		const name =
			bootstrap.method === "register" ? ((await label?.()) ?? "") : "";
		if (
			bootstrap.method === "register" &&
			(typeof name !== "string" || !name.trim() || name.length > 256)
		)
			throw new Issue("account label");
		const ceremony = crypto.randomUUID();
		const challenge = Codec.Base64Url.encode(
			crypto.getRandomValues(new Uint8Array(32)),
		);
		if (
			(await auth.options.challenges.set(ceremony, {
				challenge,
				browser: bootstrap.browser,
				method: bootstrap.method,
				action: bootstrap.action,
				origin: bootstrap.origin,
				expiration: Date.now() + 2 * Time.minute,
				...(bootstrap.user ? { user: bootstrap.user } : {}),
				...(expected.fields ? { fields: expected.fields } : {}),
			})) === false
		) {
			c.res.headers.set("retry-after", "60");
			c.text("Too many authentication requests. Try again later.", 429);
			return;
		}
		c.res.headers.set("cache-control", "no-store");
		if (bootstrap.method === "register") {
			c.json({
				ceremony,
				options: {
					challenge,
					rp: { id: rp, name: rp },
					user: {
						id: Codec.Base64Url.encode(Codec.encode(bootstrap.user!)),
						name,
						displayName: name,
					},
					pubKeyCredParams: [{ type: "public-key", alg: -7 }],
					authenticatorSelection: {
						residentKey: "required",
						requireResidentKey: true,
						userVerification: "required",
					},
					timeout: Time.minute,
					attestation: "none",
				} satisfies PublicKeyCredentialCreationOptionsJSON,
			});
		} else
			c.json({
				ceremony,
				options: {
					challenge,
					rpId: rp,
					timeout: Time.minute,
					userVerification: "required",
					// the picker offers only the user's passkeys
					...(expected.allow?.length && {
						allowCredentials: expected.allow.map((id) => ({
							type: "public-key" as const,
							id,
						})),
					}),
				} satisfies PublicKeyCredentialRequestOptionsJSON,
			});
	}

	static #decode(value: string) {
		if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1)
			throw new Issue("base64url");
		const bytes = Codec.Base64Url.decode(value);
		if (Codec.Base64Url.encode(bytes) !== value) throw new Issue("base64url");
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
			if (e instanceof DOMException) throw new Issue("public key");
			throw e;
		}
	}

	async #consume(method: "register" | "login") {
		this.#origin();
		const parsed = await this.#c
			.data({ payload: 128 * Size.kb })
			.catch(Issue.body);
		const result = Passkey.#payload.parse(
			parsed && typeof parsed === "object" && "data" in parsed
				? parsed.data
				: undefined,
		);
		if (result.issues) throw new Issue("passkey request");
		const state = await this.#auth.options.challenges.take(
			result.data.ceremony,
		);
		if (!state || state.expiration <= Date.now())
			throw new Issue("challenge (expired or consumed)");
		if (!this.#auth.browser() || state.browser !== this.#auth.browser())
			throw new Issue("browser");
		if (
			state.origin !== this.#auth.options.origin ||
			state.method !== method ||
			state.action !== this.#c.url.pathname
		)
			throw new Issue("challenge binding");
		return { state, credential: result.data.credential };
	}

	#client(value: string, state: Storage.Challenge) {
		let json: string;
		try {
			json = Codec.decode(Passkey.#decode(value));
		} catch (error) {
			// invalid UTF-8, sent by the client
			if (error instanceof Issue) throw error;
			throw new Issue("client data");
		}
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
			.parse(json);
		if (result.issues) throw new Issue("client data");
	}

	async #data(data: AuthData.Data) {
		if (
			!Passkey.#equal(
				data.rpIdHash,
				await Passkey.#hash(
					Codec.encode(new URL(this.#auth.options.origin).hostname),
				),
			)
		)
			throw new Issue("RP ID");
		if (!(data.flags & 1) || !(data.flags & 4)) throw new Issue("user");
		if (data.flags & 16 && !(data.flags & 8)) throw new Issue("backup flags");
	}

	static #equal(a: Uint8Array, b: Uint8Array) {
		if (a.length !== b.length) return false;
		let result = 0;
		for (let i = 0; i < a.length; i++) result |= a[i]! ^ b[i]!;
		return result === 0;
	}

	/** Digest canonical application values so field order cannot change the binding. */
	static async fields(value: unknown) {
		return Codec.Base64Url.encode(
			await Passkey.#hash(
				Codec.encode(
					JSON.stringify(value, (_, value) =>
						value && typeof value === "object" && !Array.isArray(value)
							? Object.fromEntries(
									Object.entries(value).sort(([a], [b]) =>
										a < b ? -1 : a > b ? 1 : 0,
									),
								)
							: value,
					),
				),
			),
		);
	}

	/** Verify registration before persisting a new credential. */
	async register(fields?: string) {
		const { state, credential } = await this.#consume("register");
		if (state.fields !== fields) throw new Issue("registration fields");
		const result = Passkey.#registration.parse(credential);
		if (result.issues) throw new Issue("registration");
		this.#client(result.data.response.clientDataJSON, state);
		const data = AuthData.parse(
			new CBOR(
				Passkey.#decode(result.data.response.attestationObject),
			).decodeAttestation(),
		);
		await this.#data(data);
		if (!data.attestedCredentialData || !state.user)
			throw new Issue("credential data");
		const id = data.attestedCredentialData.credentialId;
		if (
			!Passkey.#equal(Passkey.#decode(result.data.id), id) ||
			!Passkey.#equal(Passkey.#decode(result.data.rawId), id)
		)
			throw new Issue("credential ID");
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

	/**
	 * Verify login and atomically update the credential.
	 *
	 * @param credentials Stored credentials
	 * @param fields Form fields the ceremony was issued for, from `Passkey.fields`
	 * @param user User the ceremony offered the passkeys of, such as when
	 * allowing an agent, whose authenticator may then leave out the user handle
	 * @returns The updated credential
	 */
	async login(
		credentials: Storage.Credentials,
		fields?: string,
		user?: string,
	) {
		const { state, credential } = await this.#consume("login");
		if (state.fields !== fields) throw new Issue("login fields");
		const result = Passkey.#assertion.parse(credential);
		if (result.issues) throw new Issue("assertion");
		this.#client(result.data.response.clientDataJSON, state);
		if (
			!Passkey.#equal(
				Passkey.#decode(result.data.id),
				Passkey.#decode(result.data.rawId),
			)
		)
			throw new Issue("credential ID");
		const stored = await credentials.get(result.data.id);
		if (!stored || stored.id !== result.data.id) throw new Issue("credential");
		const handle = result.data.response.userHandle;
		// without a handle, only a passkey of the user identified before the
		// ceremony, which offered theirs (WebAuthn, verifying an assertion)
		if (
			handle
				? !Passkey.#equal(Passkey.#decode(handle), Codec.encode(stored.user))
				: stored.user !== user
		)
			throw new Issue("user handle");
		const bytes = Passkey.#decode(result.data.response.authenticatorData);
		const data = AuthData.parse(bytes);
		await this.#data(data);
		if (data.attestedCredentialData) throw new Issue("assertion flags");
		if (Boolean(data.flags & 8) !== stored.eligible)
			throw new Issue("backup eligibility");
		if (
			!Number.isSafeInteger(stored.counter) ||
			stored.counter < 0 ||
			((stored.counter || data.counter) && data.counter <= stored.counter)
		)
			throw new Issue("signature counter");
		const hash = await Passkey.#hash(
			Passkey.#decode(result.data.response.clientDataJSON),
		);
		const signed = new Uint8Array(bytes.length + hash.length);
		signed.set(bytes);
		signed.set(hash, bytes.length);
		if (
			!(await crypto.subtle.verify(
				{ name: "ECDSA", hash: "SHA-256" },
				await Passkey.#key(Passkey.#decode(stored.publicKey)),
				DER.unwrap(Passkey.#decode(result.data.response.signature)),
				signed,
			))
		)
			throw new Issue("signature");
		const updated = {
			...stored,
			counter: data.counter,
			backedUp: Boolean(data.flags & 16),
		};
		if (!(await credentials.update(updated, stored)))
			throw new Issue("credential changed");
		return updated;
	}
}
