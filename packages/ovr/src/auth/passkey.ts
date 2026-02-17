import type { Context } from "../context/index.js";
import { type JSX, jsx } from "../jsx/index.js";
import { Render } from "../render/index.js";
import type { Route } from "../route/index.js";
import { Schema } from "../schema/index.js";
import { Codec } from "../util/index.js";
import { AuthData } from "./auth-data.js";
import { CBOR, COSE } from "./cbor.js";
import { DER } from "./der.js";
import type { Auth } from "./index.js";

export namespace Passkey {
	export interface GetChallenge {
		challenge: string;
	}

	export interface CreateChallenge extends GetChallenge {
		user: string;
	}

	/** Form component returned by `create()` or `get()` */
	export type Form = (props: JSX.IntrinsicElements["form"]) => JSX.Element;
}

/**
 * WebAuthn passkey authentication.
 *
 * Implementation constraints:
 * - Only ES256 (alg -7, P-256 ECDSA) algorithm supported (https://www.rfc-editor.org/rfc/rfc8152#section-8.1)
 * - Signature counter not validated (assumes platform-bound credentials, no cloning)
 * - Discoverable/resident credentials not required (counter validation unsafe without support)
 */
export class Passkey {
	/** Auth instance for managing sessions */
	readonly #auth: Auth;

	/** Request context */
	readonly #c: Context;

	/** The relying party ID from the request hostname */
	readonly #rpId: string;

	/**
	 * Create a new Passkey instance
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
	 * Client-side passkey handler function, serialized at runtime
	 *
	 * @param signed - Signed options string to send back to server
	 * @param options - WebAuthn options JSON
	 * @param action - Form action
	 * @param method - WebAuthn method ("create" or "get")
	 */
	static #addEventListeners = (
		signed: string,
		options: PublicKeyCredentialCreationOptionsJSON &
			PublicKeyCredentialRequestOptionsJSON,
		action: string,
		method: "create" | "get",
	) => {
		class Client {
			static #transports = new Set([
				"ble",
				"hybrid",
				"internal",
				"nfc",
				"usb",
				"smart-card",
			]);

			static #attestations = new Set([
				"none",
				"indirect",
				"direct",
				"enterprise",
			]);

			static #verifications = new Set(["required", "preferred", "discouraged"]);

			static #isTransports(v?: string[]): v is AuthenticatorTransport[] {
				return Boolean(v && v.every((t) => Client.#transports.has(t)));
			}

			static #isAttestation(v?: string): v is AttestationConveyancePreference {
				return Boolean(v && Client.#attestations.has(v));
			}

			static #isVerification(v?: string): v is UserVerificationRequirement {
				return Boolean(v && Client.#verifications.has(v));
			}

			static #decodeBase64Url(s: string) {
				const b64 = s.replace(/[-_]/g, (c) => (c === "-" ? "+" : "/"));
				const pad = b64.length % 4;
				return Uint8Array.from(
					atob(pad ? b64 + "=".repeat(4 - pad) : b64),
					(c) => c.charCodeAt(0),
				).buffer;
			}

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

			static #decodeCreationOptions({
				challenge,
				user,
				excludeCredentials,
				attestation,
				extensions, // unused
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

			static #decodeRequestOptions({
				challenge,
				allowCredentials,
				userVerification,
				extensions, // unused
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

			#form = document.querySelector(
				'form[action="' + action + '"]',
			) as HTMLFormElement;

			static #loading = false;

			addEventListeners() {
				if (!this.#form.hasAttribute("data-auth")) {
					this.#form.dataset.auth = "";

					this.#form.addEventListener("formdata", (e: FormDataEvent) =>
						e.formData.append("signed", signed),
					);

					this.#form.addEventListener("submit", async (e) => {
						e.preventDefault();

						if (Client.#loading) return;

						Client.#loading = true;

						try {
							const input = document.createElement("input");
							input.type = "hidden";
							input.name = "credential";
							input.value = JSON.stringify(
								await navigator.credentials[method]({
									publicKey: (method === "create"
										? Client.#decodeCreationOptions(options)
										: Client.#decodeRequestOptions(
												options,
											)) as PublicKeyCredentialCreationOptions &
										PublicKeyCredentialRequestOptions,
								}),
							);
							this.#form.append(input);

							this.#form.submit();
							return;
						} catch (e) {
							if (
								!(e instanceof DOMException) ||
								e.name !== "NotAllowedError"
							) {
								throw e;
							}
						}

						Client.#loading = false;
					});
				}
			}
		}

		new Client().addEventListeners();
	};

	/**
	 * Generate client-side script for passkey form handling.
	 * Embeds the signed options directly in the script.
	 *
	 * @param signed - Signed options string
	 * @param options - WebAuthn options to embed
	 * @param action - The form action path
	 */
	static #script(
		signed: string,
		options:
			| PublicKeyCredentialCreationOptionsJSON
			| PublicKeyCredentialRequestOptionsJSON,
		action: string,
		method: "create" | "get",
	) {
		return `(${Passkey.#addEventListeners})(${JSON.stringify(
			signed,
		)},${JSON.stringify(options)},${JSON.stringify(action)},${JSON.stringify(
			method,
		)})`;
	}

	/**
	 * Generate a new random challenge
	 *
	 * @returns Base64url encoded challenge
	 */
	static #newChallenge() {
		return Codec.Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)));
	}

	static #NoScript() {
		return jsx("noscript", {
			children: "JavaScript is required for authentication.",
		});
	}

	/**
	 * Generate options for `navigator.credentials.create()`.
	 *
	 * Only ES256 (alg -7) is supported. Platform authenticators typically support this modern algorithm.
	 * Resident key is a hint only; counter validation is not performed due to stateless design.
	 *
	 * @param route Route to handle/verify the registration
	 * @param exclude Optional list of credential IDs to exclude from registration. Prevents duplicate registration of the same authenticator.
	 * @param user User ID for registration, defaults to `crypto.randomUUID()`
	 * @returns `<Register />` component for passkey registration containing the client script with embedded and signed options.
	 */
	create(
		route: Route.Post,
		exclude?: string[],
		user: string = crypto.randomUUID(),
	): Passkey.Form {
		return (props) => {
			return route.Form({
				...props,
				children: [
					props.children ?? jsx("button", { children: "Register" }),
					jsx("script", {
						type: "module",
						children: async () => {
							const challenge = Passkey.#newChallenge();

							return Render.html(
								Passkey.#script(
									// signed
									await this.#auth.sign(
										JSON.stringify({
											challenge,
											user,
										} satisfies Passkey.CreateChallenge),
									),
									// passkey
									{
										challenge,
										rp: { id: this.#rpId, name: this.#rpId },
										user: {
											id: Codec.Base64Url.encode(Codec.encode(user)),
											name: user,
											displayName: user,
										},
										pubKeyCredParams: [{ type: "public-key", alg: -7 }],
										excludeCredentials: exclude?.map((id) => ({
											type: "public-key",
											id,
										})),
										authenticatorSelection: {
											residentKey: "preferred",
											userVerification: "required",
										},
										timeout: 300000,
										attestation: "none",
									} satisfies PublicKeyCredentialCreationOptionsJSON,
									// action
									route.pathname(),
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
	 * Generate options for `navigator.credentials.get()`.
	 * Returns a form component that handles the WebAuthn authentication flow.
	 *
	 * The options are signed and embedded directly in the client script.
	 * The signature is verified during credential assertion to prevent tampering.
	 *
	 * @param route Route to handle the login
	 * @returns `<Login />` component for passkey login
	 */
	get(route: Route.Post): Passkey.Form {
		return (props) => {
			return route.Form({
				...props,
				children: [
					props.children ?? jsx("button", { children: "Log in" }),
					jsx("script", {
						type: "module",
						children: async () => {
							const challenge = Passkey.#newChallenge();

							return Render.html(
								Passkey.#script(
									// signed
									await this.#auth.sign(
										JSON.stringify({
											challenge,
										} satisfies Passkey.GetChallenge),
									),
									// passkey
									{
										challenge,
										rpId: this.#rpId,
										timeout: 300000,
										userVerification: "required",
									} satisfies PublicKeyCredentialRequestOptionsJSON,
									route.pathname(),
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

	static async #sha256(data: Uint8Array<ArrayBuffer>) {
		return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
	}

	static #ClientData = Schema.object({
		type: Schema.string(),
		challenge: Schema.string(),
		origin: Schema.string(),
	});
	static #Credential = Schema.object({
		type: Schema.literal("public-key"),
		id: Schema.string(),
		rawId: Schema.string(),
	});
	static #Response = Schema.object({ clientDataJSON: Schema.string() });
	static RegistrationCredential = Passkey.#Credential.extend({
		response: Passkey.#Response.extend({ attestationObject: Schema.string() }),
	});
	static AuthenticationCredential = Passkey.#Credential.extend({
		response: Passkey.#Response.extend({
			authenticatorData: Schema.string(),
			signature: Schema.string(),
		}),
	});

	/**
	 * Constant-time comparison of two byte arrays.
	 *
	 * @param a - First byte array
	 * @param b - Second byte array
	 * @returns true if arrays are equal, false otherwise
	 */
	static #safeEqual(a: Uint8Array, b: Uint8Array) {
		if (a.length !== b.length) return false;

		let result = 0;
		for (let i = 0; i < a.length; i++) result |= a[i]! ^ b[i]!;

		return result === 0;
	}

	static #FormData = Schema.object({
		credential: Schema.unknown(),
		signed: Schema.string(),
	});

	/**
	 * @param c - Request context
	 * @returns Object with credential and options, or null if invalid
	 */
	async #parseForm() {
		const data = await this.#c.form().data();
		const credential = Schema.string().parse(data.get("credential"));

		if (!credential.issues) {
			try {
				const result = Passkey.#FormData.parse({
					credential: JSON.parse(credential.data),
					signed: data.get("signed"),
				});

				if (!result.issues) return result.data;
			} catch {}
		}

		throw new TypeError("Invalid form data");
	}

	/**
	 * Common credential verification logic shared by verify() and assert().
	 *
	 * @param ceremony - Expected WebAuthn ceremony type
	 * @param credential - Validated credential data from authenticator - untrusted
	 * @param signed - Signed options string from form
	 * @returns verified and parsed options
	 */
	async #verifyCredentialBase<
		C extends "create" | "get",
		O extends C extends "create"
			? Passkey.CreateChallenge
			: Passkey.GetChallenge,
	>(
		ceremony: C,
		credential:
			| Schema.Infer<typeof Passkey.RegistrationCredential>
			| Schema.Infer<typeof Passkey.AuthenticationCredential>,
		signed: string,
	) {
		const result = Passkey.#ClientData.parse(
			JSON.parse(
				Codec.decode(
					Codec.Base64Url.decode(credential.response.clientDataJSON),
				),
			),
		);

		if (result.issues) throw result;

		if (result.data.type !== `webauthn.${ceremony}`) {
			throw new TypeError("Invalid ceremony type");
		}

		// no need to parse since its signed
		const options: O = JSON.parse(await this.#auth.verify(signed));

		if (
			!Passkey.#safeEqual(
				Codec.Base64Url.decode(result.data.challenge),
				Codec.Base64Url.decode(options.challenge),
			)
		) {
			throw new Error("Challenge mismatch");
		}

		return options;
	}

	/**
	 * Verify authenticator data flags and RP ID hash.
	 *
	 * @param authData - Parsed authenticator data
	 * @throws Error if RP ID mismatch, user not present, or user not verified
	 */
	async #verifyAuthData(authData: AuthData.Data) {
		if (
			!Passkey.#safeEqual(
				authData.rpIdHash,
				await Passkey.#sha256(Codec.encode(this.#rpId)),
			)
		) {
			throw new Error("RP ID mismatch");
		}

		if (!(authData.flags & 0x01) || !(authData.flags & 0x04)) {
			throw new Error("Unknown user");
		}
	}

	/**
	 * Verify a registration response and return credential data to store.
	 *
	 * @returns Verified credential
	 * @throws TypeError if credential is not a valid credential
	 * @throws Error if challenge expired, RP ID mismatch, user not present, or credential data missing
	 */
	async verify(): Promise<Auth.Credential> {
		const { credential, signed } = await this.#parseForm();

		const result = Passkey.RegistrationCredential.parse(credential);

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
			throw new Error("Missing credential data");
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
	 * Verify an authentication response and return the authenticated user ID.
	 *
	 * Signature counter is not validated. This is safe because the implementation assume
	 * platform-bound credentials and does not support discoverable/resident keys.
	 *
	 * @param find - Stored credential data from database
	 * @returns Authentication assertion result containing credential ID and user ID
	 * @throws TypeError if credential is not a valid credential
	 * @throws Error if challenge expired, RP ID mismatch, user not present, or signature invalid
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

		const result = Passkey.AuthenticationCredential.parse(credential);

		if (result.issues) throw result;

		const stored = await find(result.data.id);

		if (!stored) throw new Error("Credential not found");

		await this.#verifyCredentialBase("get", result.data, signed);

		if (
			!Passkey.#safeEqual(
				Codec.Base64Url.decode(result.data.id),
				Codec.Base64Url.decode(stored.id),
			)
		) {
			throw new Error("Credential ID mismatch");
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

		const verify = (signature: Uint8Array<ArrayBuffer>) =>
			crypto.subtle.verify(
				{ name: "ECDSA", hash: "SHA-256" },
				key,
				signature,
				signedData,
			);

		const sig = Codec.Base64Url.decode(result.data.response.signature);

		let ok = await verify(sig);
		if (!ok) ok = await verify(DER.unwrap(sig));
		if (!ok) throw new Error("Invalid signature");

		return stored;
	}
}
