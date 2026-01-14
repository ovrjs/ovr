import type { Context } from "../context/index.js";
import { type JSX, jsx } from "../jsx/index.js";
import { Render } from "../render/index.js";
import { S } from "../schema/index.js";
import { Codec, Mime } from "../util/index.js";
import { AuthData } from "./auth-data.js";
import { CBOR, COSE } from "./cbor.js";
import { DER } from "./der.js";
import { Auth } from "./index.js";

export namespace Passkey {
	/** User for registration */
	export type User = {
		/** Unique user identifier */
		id: string;

		/** User name/username */
		name: string;

		/** Human readable display name */
		displayName: string;
	};

	/** Stored credential data */
	export type Credential = {
		/** Credential ID */
		id: string;

		/** SPKI encoded public key as base64url */
		publicKey: string;

		/** Associated user ID */
		userId: string;
	};

	/** Form component returned by `create()` or `get()` */
	export type AuthForm = (props: JSX.IntrinsicElements["form"]) => JSX.Element;
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

			static #decodeCreationOptions = ({
				challenge,
				user,
				excludeCredentials,
				attestation,
				extensions, // unused
				...rest
			}: PublicKeyCredentialCreationOptionsJSON): PublicKeyCredentialCreationOptions => ({
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
			});

			static #decodeRequestOptions = ({
				challenge,
				allowCredentials,
				userVerification,
				extensions, // unused
				...rest
			}: PublicKeyCredentialRequestOptionsJSON): PublicKeyCredentialRequestOptions => ({
				challenge: Client.#decodeBase64Url(challenge),
				allowCredentials: allowCredentials?.map(Client.#decodeCredential),
				userVerification: Client.#isVerification(userVerification)
					? userVerification
					: undefined,
				...rest,
			});

			#forms = document.querySelectorAll(
				'form[action="' + action + '"]',
			) as NodeListOf<HTMLFormElement>;

			#loading = false;

			addEventListeners() {
				for (const f of this.#forms) {
					if (!f.hasAttribute("data-auth")) {
						f.dataset.auth = "";

						f.addEventListener("formdata", (e: FormDataEvent) =>
							e.formData.append("signed", signed),
						);

						f.addEventListener("submit", async (e) => {
							e.preventDefault();

							if (this.#loading) return;

							this.#loading = true;

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
								f.append(input);

								f.submit();
								return;
							} catch (e) {
								if (
									!(e instanceof DOMException) ||
									e.name !== "NotAllowedError"
								) {
									throw e;
								}
							}

							this.#loading = false;
						});
					}
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
		action: typeof Auth.action.register | typeof Auth.action.login,
	) {
		return `(${Passkey.#addEventListeners})('${signed}',${JSON.stringify(
			options,
		)},"${action}","${action === Auth.action.register ? "create" : "get"}")`;
	}

	/**
	 * Generate a new random challenge
	 *
	 * @returns Base64url encoded challenge
	 */
	static #newChallenge() {
		return Codec.base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
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
	 * @param user User information for registration
	 * @param excludeCredentialIds Optional list of credential IDs to exclude from registration. Prevents duplicate registration of the same authenticator.
	 * @returns `<RegisterForm />` component for passkey registration containing the client script with embedded and signed options.
	 */
	create(
		user: Passkey.User,
		excludeCredentialIds?: string[],
	): Passkey.AuthForm {
		return (props) => {
			const challenge = Passkey.#newChallenge();

			return jsx("form", {
				action: Auth.action.register,
				method: "post",
				enctype: Mime.multipartFormData,
				...props,
				children: [
					props.children,
					jsx("script", {
						type: "module",
						children: async () =>
							Render.html(
								Passkey.#script(
									// signed
									await this.#auth.sign(
										JSON.stringify({ challenge, userId: user.id }),
									),
									// passkey
									{
										challenge,
										rp: { id: this.#rpId, name: this.#rpId },
										user: {
											...user,
											id: Codec.base64url.encode(Codec.encode(user.id)),
										},
										pubKeyCredParams: [{ type: "public-key", alg: -7 }],
										excludeCredentials: excludeCredentialIds?.map((id) => ({
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
									Auth.action.register,
								),
							),
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
	 * @returns A form component for passkey login
	 */
	get(): Passkey.AuthForm {
		return (props) => {
			const challenge = Passkey.#newChallenge();

			return jsx("form", {
				action: Auth.action.login,
				method: "post",
				enctype: Mime.multipartFormData,
				...props,
				children: [
					props.children,
					jsx("script", {
						type: "module",
						children: async () =>
							Render.html(
								Passkey.#script(
									// signed
									await this.#auth.sign(JSON.stringify({ challenge })),
									// passkey
									{
										challenge,
										rpId: this.#rpId,
										timeout: 300000,
										userVerification: "required",
									} satisfies PublicKeyCredentialRequestOptionsJSON,
									Auth.action.login,
								),
							),
					}),
					Passkey.#NoScript,
				],
			});
		};
	}

	static async #sha256(data: Uint8Array<ArrayBuffer>) {
		return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
	}

	static #ClientData = S.object({
		type: S.string(),
		challenge: S.string(),
		origin: S.string(),
	});
	static #Credential = S.object({
		type: S.string("public-key"),
		id: S.string(),
		rawId: S.string(),
	});
	static #Response = S.object({ clientDataJSON: S.string() });
	static RegistrationCredential = Passkey.#Credential.extend({
		response: Passkey.#Response.extend({ attestationObject: S.string() }),
	});
	static AuthenticationCredential = Passkey.#Credential.extend({
		response: Passkey.#Response.extend({
			authenticatorData: S.string(),
			signature: S.string(),
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
			? { challenge: string; userId: string }
			: { challenge: string },
	>(
		ceremony: C,
		credential:
			| S.Infer<typeof Passkey.RegistrationCredential>
			| S.Infer<typeof Passkey.AuthenticationCredential>,
		signed: string,
	) {
		const clientData = Passkey.#ClientData.parse(
			JSON.parse(
				Codec.decode(
					Codec.base64url.decode(credential.response.clientDataJSON),
				),
			),
		);

		if (clientData.type !== `webauthn.${ceremony}`) {
			throw new TypeError("Invalid ceremony type");
		}

		const options: O = JSON.parse(await this.#auth.verify(signed));

		if (
			!Passkey.#safeEqual(
				Codec.base64url.decode(clientData.challenge),
				Codec.base64url.decode(options.challenge),
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
	 * @param credential Registration credential response from authenticator - untrusted
	 * @param signed Signed options string from form submission
	 * @returns Credential verification result containing ID, public key, and userId
	 * @throws TypeError if credential is not a valid credential
	 * @throws Error if challenge expired, RP ID mismatch, user not present, or credential data missing
	 */
	async verify(
		credential: unknown,
		signed: string,
	): Promise<Passkey.Credential> {
		const parsed = Passkey.RegistrationCredential.parse(credential);

		const options = await this.#verifyCredentialBase("create", parsed, signed);

		const authData = AuthData.parse(
			new CBOR(
				Codec.base64url.decode(parsed.response.attestationObject),
			).decodeAttestation(),
		);

		await this.#verifyAuthData(authData);

		if (!authData.attestedCredentialData) {
			throw new Error("Missing credential data");
		}

		return {
			id: Codec.base64url.encode(authData.attestedCredentialData.credentialId),
			publicKey: Codec.base64url.encode(
				COSE.toSPKI(authData.attestedCredentialData.publicKey),
			),
			userId: options.userId,
		};
	}

	/**
	 * Verify an authentication response and return the authenticated user ID.
	 *
	 * Signature counter is not validated. This is safe because the implementation assume
	 * platform-bound credentials and does not support discoverable/resident keys.
	 *
	 * @param credential - Authentication credential response from authenticator - untrusted
	 * @param signed - Signed options string from form submission
	 * @param stored - Stored credential data from database
	 * @returns Authentication assertion result containing credential ID and user ID
	 * @throws TypeError if credential is not a valid credential
	 * @throws Error if challenge expired, RP ID mismatch, user not present, or signature invalid
	 */
	async assert(
		credential: unknown,
		signed: string,
		stored: Passkey.Credential,
	) {
		const parsed = Passkey.AuthenticationCredential.parse(credential);

		await this.#verifyCredentialBase("get", parsed, signed);

		if (
			!Passkey.#safeEqual(
				Codec.base64url.decode(parsed.id),
				Codec.base64url.decode(stored.id),
			)
		) {
			throw new Error("Credential ID mismatch");
		}

		const authDataBytes = Codec.base64url.decode(
			parsed.response.authenticatorData,
		);

		await this.#verifyAuthData(AuthData.parse(authDataBytes));

		const clientDataHash = await Passkey.#sha256(
			Codec.base64url.decode(parsed.response.clientDataJSON),
		);

		const signedData = new Uint8Array(
			authDataBytes.length + clientDataHash.length,
		);
		signedData.set(authDataBytes);
		signedData.set(clientDataHash, authDataBytes.length);

		const key = await crypto.subtle.importKey(
			"spki",
			Codec.base64url.decode(stored.publicKey),
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

		const sig = Codec.base64url.decode(parsed.response.signature);

		let ok = await verify(sig);
		if (!ok) ok = await verify(DER.unwrap(sig));
		if (!ok) throw new Error("Invalid signature");

		return stored;
	}
}
