import type { Context } from "../context/index.js";
import { jsx } from "../jsx/index.js";
import { Render } from "../render/index.js";
import { Route } from "../route/index.js";
import { Schema } from "../schema/index.js";
import { Codec, Header, Time } from "../util/index.js";
import { AuthData } from "./auth-data.js";
import { CBOR, COSE } from "./cbor.js";
import { DER } from "./der.js";
import type { Auth } from "./index.js";
import { AuthIssue } from "./issue.js";

export namespace Passkey {
	/**
	 * Route contract accepted by `create()` and `get()`.
	 *
	 * Pass any `Route.post(...)` route and this keeps route params typed
	 * for both the rendered form action and challenge binding.
	 */
	export interface Post<Pattern extends string> extends Omit<
		Route.Post,
		"url" | "pathname"
	> {
		pattern: Pattern;
		Form: Route.Form<Pattern>;
		url: Route<Pattern>["url"];
		pathname: (params?: Record<string, string>) => string;
	}
}

/**
 * Minimal stateless passkey authentication.
 *
 * Features:
 *
 * - Register and login form helpers for WebAuthn.
 * - Signed challenges bound to route path and origin.
 * - Fresh options generated at submit time.
 * - Built-in challenge expiry (1 minute).
 *
 * Security model:
 *
 * - Challenges are stateless and not one-time consumed.
 * - Replay is time-bounded by challenge expiry.
 * - Signature counters are not validated.
 */
export class Passkey {
	/** Challenge validity window in milliseconds. */
	static #challengeTtl = Time.minute;

	/** Request-scoped auth helper for challenge signing and verification. */
	readonly #auth: Auth;

	/** Current request context used for origin/rp checks and form parsing. */
	readonly #c: Context;

	/** Relying party identifier derived from the request hostname. */
	readonly #rpId: string;

	/**
	 * Create a passkey helper for the current request.
	 *
	 * @param c Request context
	 * @param auth Auth instance
	 */
	constructor(c: Context, auth: Auth) {
		this.#c = c;
		this.#auth = auth;
		this.#rpId = this.#c.url.hostname;
	}

	/**
	 * Client runtime injected into passkey forms.
	 *
	 * - This function is serialized and executed in the browser.
	 * - Keep dependencies self-contained and browser-native.
	 * - Do not reference server-only helpers (for example `Schema`).
	 *
	 * @param bootstrap Signed bootstrap payload used to fetch fresh options
	 * @param optionsAction Internal options route pathname
	 * @param action Target form action pathname
	 * @param method WebAuthn ceremony invoked by the browser
	 */
	static #addEventListeners = (
		bootstrap: string,
		optionsAction: string,
		action: string,
		method: "create" | "get",
	) => {
		class Client {
			/** Allowed transport values accepted from JSON options. */
			static #transports = new Set([
				"ble",
				"hybrid",
				"internal",
				"nfc",
				"usb",
				"smart-card",
			]);

			/** Allowed attestation values accepted from JSON options. */
			static #attestations = new Set([
				"none",
				"indirect",
				"direct",
				"enterprise",
			]);

			/** Allowed verification values accepted from JSON options. */
			static #verifications = new Set(["required", "preferred", "discouraged"]);

			/**
			 * Narrow transport values from untyped JSON.
			 *
			 * @param v Candidate transport list from options JSON
			 * @returns `true` when all values are valid authenticator transports
			 */
			static #isTransports(v?: string[]): v is AuthenticatorTransport[] {
				return Boolean(v && v.every((t) => Client.#transports.has(t)));
			}

			/**
			 * Narrow attestation value from untyped JSON.
			 *
			 * @param v Candidate attestation value from options JSON
			 * @returns `true` when value is a valid attestation preference
			 */
			static #isAttestation(v?: string): v is AttestationConveyancePreference {
				return Boolean(v && Client.#attestations.has(v));
			}

			/**
			 * Narrow user verification value from untyped JSON.
			 *
			 * @param v Candidate verification value from options JSON
			 * @returns `true` when value is a valid verification requirement
			 */
			static #isVerification(v?: string): v is UserVerificationRequirement {
				return Boolean(v && Client.#verifications.has(v));
			}

			/**
			 * Decode base64url strings from JSON options into binary buffers.
			 *
			 * @param s Base64url-encoded input
			 * @returns Decoded bytes as an `ArrayBuffer`
			 */
			static #decodeBase64Url(s: string) {
				const b64 = s.replace(/[-_]/g, (c) => (c === "-" ? "+" : "/"));
				const pad = b64.length % 4;

				return Uint8Array.from(
					atob(pad ? b64 + "=".repeat(4 - pad) : b64),
					(c) => c.charCodeAt(0),
				).buffer;
			}

			/**
			 * Decode a credential descriptor payload for WebAuthn browser APIs.
			 *
			 * @param json Credential descriptor from JSON options
			 * @returns Descriptor with decoded binary ID
			 */
			static #decodeCredential(
				json: PublicKeyCredentialDescriptorJSON,
			): PublicKeyCredentialDescriptor {
				return {
					type: "public-key",
					id: Client.#decodeBase64Url(json.id),
					transports: Client.#isTransports(json.transports)
						? json.transports
						: undefined,
				};
			}

			/**
			 * Decode registration options into browser-native WebAuthn options.
			 *
			 * @param options Registration options JSON payload
			 * @returns Browser-ready registration options
			 */
			static #decodeCreationOptions({
				challenge,
				user,
				excludeCredentials,
				attestation,
				extensions: _extensions,
				...rest
			}: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions {
				return {
					challenge: Client.#decodeBase64Url(challenge),
					user: {
						id: Client.#decodeBase64Url(user.id),
						name: user.name,
						displayName: user.displayName,
					},
					excludeCredentials: excludeCredentials?.map(Client.#decodeCredential),
					attestation: Client.#isAttestation(attestation)
						? attestation
						: undefined,
					...rest,
				};
			}

			/**
			 * Decode login options into browser-native WebAuthn options.
			 *
			 * @param options Authentication options JSON payload
			 * @returns Browser-ready authentication options
			 */
			static #decodeRequestOptions({
				challenge,
				allowCredentials,
				userVerification,
				extensions: _extensions,
				...rest
			}: PublicKeyCredentialRequestOptionsJSON): PublicKeyCredentialRequestOptions {
				return {
					challenge: Client.#decodeBase64Url(challenge),
					allowCredentials: allowCredentials?.map(Client.#decodeCredential),
					userVerification: Client.#isVerification(userVerification)
						? userVerification
						: undefined,
					...rest,
				};
			}

			/** Forms whose `action` starts with the bound route pathname. */
			#forms = document.querySelectorAll(
				'form[action^="' + action + '"]',
			) as NodeListOf<HTMLFormElement>;

			/** Shared submit lock to prevent duplicate requests across matching forms. */
			static #loading = false;

			/**
			 * Attach one submit handler per matching form.
			 *
			 * The handler fetches fresh options, runs the WebAuthn API, writes hidden
			 * fields, then triggers native form submission.
			 */
			init() {
				for (const form of this.#forms) {
					if (form.hasAttribute("data-auth")) continue;

					form.dataset.auth = "";

					const credential = document.createElement("input");
					credential.type = "hidden";
					credential.name = "credential";

					const signed = document.createElement("input");
					signed.type = "hidden";
					signed.name = "signed";

					form.addEventListener("submit", async (e) => {
						e.preventDefault();

						if (Client.#loading) return;
						Client.#loading = true;

						try {
							const data = new FormData();
							data.append("bootstrap", bootstrap);

							const res = await fetch(optionsAction, {
								method: "POST",
								body: data,
							});

							if (!res.ok) {
								throw new Error(
									`Passkey options request failed (${res.status})`,
								);
							}

							const options = (await res.json()) as {
								signed: string;
								options: PublicKeyCredentialCreationOptionsJSON &
									PublicKeyCredentialRequestOptionsJSON;
							};

							signed.value = options.signed;
							credential.value = JSON.stringify(
								await navigator.credentials[method]({
									publicKey: (method === "create"
										? Client.#decodeCreationOptions(options.options)
										: Client.#decodeRequestOptions(
												options.options,
											)) as PublicKeyCredentialCreationOptions &
										PublicKeyCredentialRequestOptions,
								}),
							);

							form.append(credential, signed);
							form.submit();
							return;
						} catch (e) {
							if (
								!(e instanceof DOMException) ||
								e.name !== "NotAllowedError"
							) {
								throw e;
							}
						} finally {
							Client.#loading = false;
						}
					});
				}
			}
		}

		new Client().init();
	};

	/** Regex to find characters that can break inline script parsing. */
	static readonly #escapeJsPattern = /[<>&\u2028\u2029]/g;

	/** Character map to produce JS-safe unicode escapes. */
	static readonly #escapeJsMap: Record<string, string> = {
		"<": "\\u003c",
		">": "\\u003e",
		"&": "\\u0026",
		"\u2028": "\\u2028",
		"\u2029": "\\u2029",
	};

	/**
	 * Escape unsafe characters for inline JavaScript source.
	 *
	 * @param s JavaScript source fragment
	 * @returns Source with characters escaped as unicode sequences
	 */
	static #escapeJs(s: string) {
		return s.replace(Passkey.#escapeJsPattern, (c) => Passkey.#escapeJsMap[c]!);
	}

	/**
	 * Serialize the browser runtime with safely escaped arguments.
	 *
	 * @param args Runtime args injected into the client initializer
	 * @returns Inline script source
	 */
	static #script(
		...args: [
			bootstrap: string,
			optionsAction: string,
			action: string,
			method: "create" | "get",
		]
	) {
		return `(${Passkey.#addEventListeners})(${args.map((arg) => Passkey.#escapeJs(JSON.stringify(arg))).join()})`;
	}

	/**
	 * Create a random challenge payload with freshness bounds.
	 *
	 * @returns Challenge payload used by signed option responses
	 */
	static #newChallenge() {
		const iat = Date.now();

		return {
			challenge: Codec.Base64Url.encode(
				crypto.getRandomValues(new Uint8Array(32)),
			),
			iat,
			exp: iat + Passkey.#challengeTtl,
		};
	}

	/**
	 * Render fallback markup for users with JavaScript disabled.
	 *
	 * @returns `<noscript>` fallback element
	 */
	static #NoScript() {
		return jsx("noscript", {
			children: "JavaScript is required for authentication.",
		});
	}

	/**
	 * Build a registration form component for a route.
	 *
	 * - Fetches fresh WebAuthn options when the form is submitted.
	 * - Requires JavaScript on the page.
	 * - Uses signed challenges that expire after 1 minute.
	 *
	 * @param route Route to handle/verify the registration
	 * @param exclude Existing credential IDs to exclude from registration
	 * @param user User ID for registration, defaults to `crypto.randomUUID()`
	 * @returns Form component for passkey registration
	 */
	create<const Pattern extends string>(
		route: Passkey.Post<Pattern>,
		exclude?: string[],
		user: string = crypto.randomUUID(),
	): Route.Form<Pattern> {
		return (props) => {
			return route.Form({
				...props,
				children: [
					props.children ?? [
						route.Fields?.(),
						jsx("button", { children: "Register" }),
					],
					jsx("script", {
						type: "module",
						children: async () => {
							const action = route.pathname(props.params);

							return Render.html(
								Passkey.#script(
									await this.#auth.sign(
										JSON.stringify({
											method: "create",
											action,
											user,
											exclude,
										} satisfies Schema.Infer<typeof Passkey.bCreate>),
									),
									Passkey.options.url(),
									action,
									"create",
								),
							);
						},
					}),
					Passkey.#NoScript,
				],
			});
		};
	}

	/**
	 * Build a login form component for a route.
	 *
	 * - Fetches fresh WebAuthn options when the form is submitted.
	 * - Requires JavaScript on the page.
	 * - Uses signed challenges that expire after 1 minute.
	 *
	 * @param route Route to handle the login
	 * @returns Form component for passkey login
	 */
	get<const Pattern extends string>(
		route: Passkey.Post<Pattern>,
	): Route.Form<Pattern> {
		return (props) => {
			return route.Form({
				...props,
				children: [
					props.children ?? jsx("button", { children: "Log in" }),
					jsx("script", {
						type: "module",
						children: async () => {
							const action = route.pathname(props.params);

							return Render.html(
								Passkey.#script(
									await this.#auth.sign(
										JSON.stringify({
											method: "get",
											action,
										} satisfies Schema.Infer<typeof Passkey.bGet>),
									),
									Passkey.options.url(),
									action,
									"get",
								),
							);
						},
					}),
					Passkey.#NoScript,
				],
			});
		};
	}

	/**
	 * Create a SHA-256 digest from binary input.
	 *
	 * @param data Input bytes
	 * @returns Digest bytes
	 */
	static async #sha256(data: Uint8Array<ArrayBuffer>) {
		return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
	}

	/**
	 * Build parser for decoded `clientDataJSON`.
	 *
	 * - Enforces ceremony type via literal match.
	 * - Enforces expected origin via literal match.
	 *
	 * @param ceremony Expected WebAuthn ceremony
	 * @param origin Expected request origin
	 * @returns Schema parser for decoded client data
	 */
	static #clientData = (ceremony: "create" | "get", origin: string) =>
		Schema.json(
			Schema.object({
				type: Schema.literal(`webauthn.${ceremony}`),
				challenge: Schema.string(),
				origin: Schema.literal(origin, AuthIssue.m("origin")),
			}),
		);

	/**
	 * Schema for signed login challenge payloads.
	 *
	 * Supports app-side type inference for signed challenge payloads.
	 */
	static get = Schema.object({
		challenge: Schema.string(),
		iat: Schema.int(),
		exp: Schema.int(),
		action: Schema.string(),
	});

	/**
	 * Schema for signed registration challenge payloads.
	 *
	 * Supports app-side type inference for signed challenge payloads.
	 */
	static create = Passkey.get.extend({ user: Schema.string() });

	/**
	 * Build parser for signed challenge payloads bound to a route path.
	 *
	 * @param ceremony Expected WebAuthn ceremony
	 * @param action Expected route pathname
	 * @returns Schema parser for signed challenge payloads
	 */
	static #challenge = (ceremony: "create" | "get", action: string) => {
		return Schema.json(
			(ceremony === "create" ? Passkey.create : Passkey.get).extend({
				action: Schema.literal(action, AuthIssue.m("action")),
			}),
		).refine((c) => Date.now() <= c.exp, AuthIssue.m("challenge (expired)"));
	};

	/** Schema for signed registration bootstrap payloads. */
	static bCreate = Schema.object({
		method: Schema.literal("create"),
		action: Schema.string(),
		user: Schema.string(),
		exclude: Schema.array(Schema.string()).optional(),
	});

	/** Schema for signed login bootstrap payloads. */
	static bGet = Schema.object({
		method: Schema.literal("get"),
		action: Schema.string(),
	});

	/** Shared credential envelope for parsed registration/login form data. */
	static #credential = Schema.object({
		type: Schema.literal("public-key"),
		id: Schema.string(),
		rawId: Schema.string(),
	});

	/** Shared response field shape required by both credential payload types. */
	static #response = Schema.object({ clientDataJSON: Schema.string() });

	/**
	 * Schema for parsed registration credentials from form submissions.
	 */
	static reg = Passkey.#credential.extend({
		response: Passkey.#response.extend({ attestationObject: Schema.string() }),
	});

	/**
	 * Schema for parsed authentication credentials from form submissions.
	 */
	static auth = Passkey.#credential.extend({
		response: Passkey.#response.extend({
			authenticatorData: Schema.string(),
			signature: Schema.string(),
		}),
	});

	/**
	 * Route that returns fresh signed passkey options.
	 *
	 * Required route for `create()` and `get()` form helpers.
	 */
	static readonly options = Route.post(
		{ bootstrap: Schema.Field.text() },
		async (c) => {
			const input = await c.data();

			if (input.issues) throw input;

			const bootstrap = Schema.json(
				Schema.union([Passkey.bCreate, Passkey.bGet]),
			).parse(await c.auth.verify(input.data.bootstrap));

			if (bootstrap.issues) throw bootstrap;

			c.res.headers.set(Header.name.cache, "no-store");

			const { challenge, iat, exp } = Passkey.#newChallenge();
			const rpId = c.url.hostname;

			if (bootstrap.data.method === "create") {
				return c.json({
					signed: await c.auth.sign(
						JSON.stringify({
							challenge,
							user: bootstrap.data.user,
							iat,
							exp,
							action: bootstrap.data.action,
						} satisfies Schema.Infer<typeof Passkey.create>),
					),
					options: {
						challenge,
						rp: { id: rpId, name: rpId },
						user: {
							id: Codec.Base64Url.encode(Codec.encode(bootstrap.data.user)),
							name: bootstrap.data.user,
							displayName: bootstrap.data.user,
						},
						pubKeyCredParams: [{ type: "public-key", alg: -7 }],
						excludeCredentials: bootstrap.data.exclude?.map((id) => ({
							type: "public-key",
							id,
						})),
						authenticatorSelection: {
							residentKey: "preferred",
							userVerification: "required",
						},
						timeout: Passkey.#challengeTtl,
						attestation: "none",
					} satisfies PublicKeyCredentialCreationOptionsJSON,
				});
			}

			return c.json({
				signed: await c.auth.sign(
					JSON.stringify({
						challenge,
						iat,
						exp,
						action: bootstrap.data.action,
					} satisfies Schema.Infer<typeof Passkey.get>),
				),
				options: {
					challenge,
					rpId,
					timeout: Passkey.#challengeTtl,
					userVerification: "required",
				} satisfies PublicKeyCredentialRequestOptionsJSON,
			});
		},
	);

	/**
	 * Compare byte arrays without early return.
	 *
	 * Maintainer note: use for security-sensitive comparisons.
	 *
	 * @param a First byte array
	 * @param b Second byte array
	 * @returns `true` when both arrays are equal
	 */
	static #safeEqual(a: Uint8Array, b: Uint8Array) {
		if (a.length !== b.length) return false;

		let result = 0;
		for (let i = 0; i < a.length; i++) result |= a[i]! ^ b[i]!;

		return result === 0;
	}

	/**
	 * Parse and validate passkey fields from the current form request.
	 *
	 * @returns Parsed form payload
	 * @throws Schema.AggregateIssue when required fields are missing or invalid
	 */
	async #parseForm() {
		const data = await this.#c.form().data();
		const result = Schema.object({
			credential: Schema.json(Schema.unknown()),
			signed: Schema.string(),
		}).parse({
			credential: data.get("credential"),
			signed: data.get("signed"),
		});

		if (result.issues) throw result;

		return result.data;
	}

	/**
	 * Shared challenge + client-data verification for both ceremonies.
	 *
	 * - Verifies signed payload integrity via `auth.verify`.
	 * - Validates origin, ceremony type, action binding, and expiry.
	 * - Compares challenge bytes from client and signed payload.
	 *
	 * @param ceremony Ceremony to verify (`create` or `get`)
	 * @param credential Parsed credential payload
	 * @param signed Signed challenge payload string
	 * @returns Parsed signed challenge payload for the ceremony
	 * @throws Schema.AggregateIssue for invalid credential or challenge input shape
	 * @throws Auth.Issue for invalid auth challenge state
	 */
	async #verifyCredentialBase<
		C extends "create" | "get",
		O extends C extends "create"
			? Schema.Infer<typeof Passkey.create>
			: Schema.Infer<typeof Passkey.get>,
	>(
		ceremony: C,
		credential:
			| Schema.Infer<typeof Passkey.reg>
			| Schema.Infer<typeof Passkey.auth>,
		signed: string,
	) {
		const client = Passkey.#clientData(ceremony, this.#c.url.origin).parse(
			Codec.decode(Codec.Base64Url.decode(credential.response.clientDataJSON)),
		);

		if (client.issues) throw client;

		const options = Passkey.#challenge(ceremony, this.#c.url.pathname).parse(
			await this.#auth.verify(signed),
		);

		if (options.issues) throw options;

		if (
			!Passkey.#safeEqual(
				Codec.Base64Url.decode(client.data.challenge),
				Codec.Base64Url.decode(options.data.challenge),
			)
		) {
			throw new AuthIssue("challenge");
		}

		return options.data as O;
	}

	/**
	 * Verify RP binding and required user flags in authenticator data.
	 *
	 * @param authData Parsed authenticator data structure
	 * @throws Auth.Issue when RP ID hash mismatches or required flags are absent
	 */
	async #verifyAuthData(authData: AuthData.Data) {
		if (
			!Passkey.#safeEqual(
				authData.rpIdHash,
				await Passkey.#sha256(Codec.encode(this.#rpId)),
			)
		) {
			throw new AuthIssue("RP ID");
		}

		if (!(authData.flags & 0x01) || !(authData.flags & 0x04)) {
			throw new AuthIssue("user");
		}
	}

	/**
	 * Verify a registration response.
	 *
	 * Persist the returned credential and associate it with the user account.
	 *
	 * @returns Verified credential to persist
	 * @throws Schema.AggregateIssue if form fields, credential payload, or signed challenge payload are invalid
	 * @throws Auth.Issue if challenge, RP/user flags, or attested credential state is invalid
	 */
	async verify(): Promise<Auth.Credential> {
		const { credential, signed } = await this.#parseForm();

		const result = Passkey.reg.parse(credential);

		if (result.issues) throw result;

		const options = await this.#verifyCredentialBase(
			"create",
			result.data,
			signed,
		);

		const authData = AuthData.parse(
			new CBOR(
				Codec.Base64Url.decode(result.data.response.attestationObject),
			).decodeAttestation(),
		);

		await this.#verifyAuthData(authData);

		if (!authData.attestedCredentialData) {
			throw new AuthIssue("credential data");
		}

		return {
			id: Codec.Base64Url.encode(authData.attestedCredentialData.credentialId),
			publicKey: Codec.Base64Url.encode(
				COSE.toSPKI(authData.attestedCredentialData.publicKey),
			),
			user: options.user,
		};
	}

	/**
	 * Verify a login assertion.
	 *
	 * - Signature counters are not validated.
	 * - Challenge usage is stateless and replay-protected only by challenge expiry.
	 *
	 * @param find Lookup function that returns the stored credential by credential ID
	 * @returns Stored credential when assertion verification succeeds
	 * @throws Schema.AggregateIssue if form fields, credential payload, or signed challenge payload are invalid
	 * @throws Auth.Issue if challenge, credential lookup/state, RP/user flags, or signature state is invalid
	 */
	async assert(
		find: (
			id: Auth.Credential["id"],
		) =>
			| Promise<Auth.Credential | null | undefined>
			| Auth.Credential
			| null
			| undefined,
	) {
		const { credential, signed } = await this.#parseForm();

		const result = Passkey.auth.parse(credential);

		if (result.issues) throw result;

		await this.#verifyCredentialBase("get", result.data, signed);

		const stored = await find(result.data.id);

		if (!stored) throw new AuthIssue("credential");

		if (
			!Passkey.#safeEqual(
				Codec.Base64Url.decode(result.data.id),
				Codec.Base64Url.decode(stored.id),
			)
		) {
			throw new AuthIssue("credential ID");
		}

		const authDataBytes = Codec.Base64Url.decode(
			result.data.response.authenticatorData,
		);

		await this.#verifyAuthData(AuthData.parse(authDataBytes));

		const clientDataHash = await Passkey.#sha256(
			Codec.Base64Url.decode(result.data.response.clientDataJSON),
		);

		const signedData = new Uint8Array(
			authDataBytes.length + clientDataHash.length,
		);
		signedData.set(authDataBytes);
		signedData.set(clientDataHash, authDataBytes.length);

		const key = await crypto.subtle.importKey(
			"spki",
			Codec.Base64Url.decode(stored.publicKey),
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"],
		);

		const verify = async (signature: Uint8Array<ArrayBuffer>) => {
			try {
				return await crypto.subtle.verify(
					{ name: "ECDSA", hash: "SHA-256" },
					key,
					signature,
					signedData,
				);
			} catch {}
		};

		const sig = Codec.Base64Url.decode(result.data.response.signature);

		if (!(await verify(sig))) {
			try {
				if (!(await verify(DER.unwrap(sig)))) throw new AuthIssue("signature");
			} catch {
				throw new AuthIssue("signature");
			}
		}

		return stored;
	}
}
