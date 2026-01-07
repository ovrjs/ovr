import type { Context } from "../context/index.js";
import { Codec, Time } from "../util/index.js";

export namespace Auth {
	export type Options = {
		/** Secret key for signing sessions and challenges */
		readonly secret: string;

		/**
		 * Cookie name
		 *
		 * @default "__Host-session"
		 */
		readonly cookie?: string;

		/**
		 * Session duration in ms
		 *
		 * @default 1000 * 60 * 60 * 24 * 7
		 */
		readonly duration?: number;

		/**
		 * Sliding session refresh threshold in ms.
		 *
		 * @default duration / 4
		 */
		readonly refresh?: number;
	};

	export type Session = {
		/** Session ID */
		readonly id: string;

		/** Session expiration time */
		readonly expiration: number;
	};
}

/**
 * Stateless authentication helper with passkey support.
 */
export class Auth {
	/** Cached auth keys in case of multiple App instances */
	static readonly #keys = new Map<string, Promise<CryptoKey>>();

	/** Request context */
	readonly #c: Context;

	/** Auth user options */
	readonly options;

	/** Passkey methods */
	readonly passkey: Passkey;

	/**
	 * Create a new auth instance
	 *
	 * @param c Request context
	 * @param options Auth options
	 */
	constructor(c: Context, options: Auth.Options) {
		this.#c = c;
		this.options = Object.assign(
			{
				cookie: "__Host-session",
				duration: Time.week,
				refresh: (options.duration ?? Time.week) / 4,
			} satisfies Omit<Auth.Options, "secret">,
			options,
		);
		this.passkey = new Passkey(c, this);
	}

	/** Gets the corresponding key for the app handling the request */
	get #key() {
		let key = Auth.#keys.get(this.options.secret);

		if (!key) {
			Auth.#keys.set(
				this.options.secret,
				(key = crypto.subtle.importKey(
					"raw",
					Codec.encode(this.options.secret),
					{ name: "HMAC", hash: "SHA-256" },
					false,
					["sign", "verify"],
				)),
			);
		}

		return key;
	}

	/**
	 * @param payload
	 * @returns HMAC signed `payload.signature` with auth secret
	 */
	async sign(payload: string) {
		return `${payload}.${Codec.base64url.encode(
			new Uint8Array(
				await crypto.subtle.sign(
					"HMAC",
					await this.#key,
					Codec.encode(payload),
				),
			),
		)}`;
	}

	/**
	 * @param token signed token
	 * @returns payload if valid, otherwise null
	 */
	async verify(token: string) {
		const dot = token.lastIndexOf(".");
		if (dot === -1) return null;

		const payload = token.slice(0, dot);
		const sig = token.slice(dot + 1);

		if (payload && sig) {
			try {
				if (
					await crypto.subtle.verify(
						"HMAC",
						await this.#key,
						Codec.base64url.decode(sig),
						Codec.encode(payload),
					)
				) {
					return payload;
				}
			} catch {}
		}

		return null;
	}

	/**
	 * Set/expire the auth session cookie
	 *
	 * @param session
	 */
	async #setCookie<S extends Auth.Session | null>(session: S): Promise<S> {
		this.#c.cookie.set(
			this.options.cookie,
			session
				? await this.sign(
						Codec.base64url.encode(Codec.encode(JSON.stringify(session))),
					)
				: "",
			{
				httpOnly: true,
				secure: true,
				sameSite: "Lax",
				maxAge: session ? Math.floor(this.options.duration / 1000) : 0,
			},
		);

		return session;
	}

	/**
	 * Reads the current auth session from the cookie
	 *
	 * @returns current or null
	 */
	async session() {
		const token = this.#c.cookie.get(this.options.cookie);
		if (!token) return null;

		const payload = await this.verify(token);

		if (payload) {
			try {
				const session = JSON.parse(
					Codec.decode(Codec.base64url.decode(payload)),
				) as Auth.Session;

				if (Date.now() < session.expiration) {
					return session.expiration - Date.now() < this.options.refresh
						? this.#setCookie({
								...session,
								expiration: Date.now() + this.options.duration,
							})
						: session;
				}
			} catch {}
		}

		return this.logout();
	}

	/**
	 * @param id user ID to login
	 * @returns new session
	 */
	login(id: string) {
		return this.#setCookie({
			id,
			expiration: Date.now() + this.options.duration,
		});
	}

	/** Logs out the user by expiring the session cookie */
	logout() {
		return this.#setCookie(null);
	}
}

export namespace Passkey {
	/** Helper type to convert Buffers into strings for sending as JSON */
	type ToJSON<T> = {
		[K in keyof T]: T[K] extends ArrayBuffer | Uint8Array | BufferSource
			? Base64URLString
			: T[K];
	};

	/** Base credential type */
	type CredentialJSON<TResponse> = {
		/** Credential ID as base64url string */
		id: Base64URLString;

		/** Raw credential ID as base64url string */
		rawId: Base64URLString;

		/** Credential type identifier */
		type: "public-key";

		/** Authenticator response data */
		response: TResponse;
	};

	/** Registration credential response from authenticator */
	export type RegistrationCredentialJSON = CredentialJSON<
		ToJSON<AuthenticatorAttestationResponse> & { publicKey?: Base64URLString }
	>;

	/** Authentication credential response from authenticator */
	export type AuthenticationCredentialJSON = CredentialJSON<
		ToJSON<AuthenticatorAssertionResponse>
	>;

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

		/** Signature counter */
		// counter: number;
	};

	/** Registration verification result */
	export type VerifyResult = {
		/** Credential ID from registration */
		credentialId: string;

		/** SPKI encoded public key as base64url */
		publicKey: string;

		/** Initial signature counter */
		// counter: number;
	};

	/** Authentication assertion result */
	export type AssertResult = {
		/** Credential ID used for authentication */
		credentialId: string;

		/** Associated user ID */
		userId: string;

		/** Updated signature counter */
		// counter: number;
	};
}

/** WebAuthn passkey authentication */
export class Passkey {
	/** Error thrown when credential parsing fails */
	static readonly #invalidCredential = new TypeError("Invalid credential");

	/** Auth instance for managing sessions */
	readonly #auth: Auth;

	/** Request context */
	readonly #c: Context;

	/** Cookie name for storing WebAuthn challenges */
	readonly #challengeCookie: string;

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
		this.#challengeCookie = `${this.#auth.options.cookie}-challenge`;
		this.#rpId = this.#c.url.hostname;
	}

	/**
	 * Create secure cookie options for WebAuthn operations
	 *
	 * @param maxAge
	 */
	static #challengeOptions(maxAge: number) {
		return {
			httpOnly: true,
			secure: true,
			sameSite: "Strict",
			maxAge,
		} as const;
	}

	/**
	 * Constant-time comparison of two byte arrays.
	 *
	 * @param a - First byte array
	 * @param b - Second byte array
	 * @returns true if arrays are equal, false otherwise
	 */
	static #timingSafeEqual(a: Uint8Array, b: Uint8Array) {
		if (a.length !== b.length) return false;

		let result = 0;
		for (let i = 0; i < a.length; i++) result |= a[i]! ^ b[i]!;

		return result === 0;
	}

	/**
	 * Store a WebAuthn challenge in a signed cookie
	 *
	 * @returns Random bytes that are signed and stored
	 */
	async #newChallenge() {
		const challenge = Codec.base64url.encode(
			crypto.getRandomValues(new Uint8Array(32)),
		);

		this.#c.cookie.set(
			this.#challengeCookie,
			await this.#auth.sign(challenge),
			Passkey.#challengeOptions(300),
		);

		return challenge;
	}

	/**
	 * Retrieve and clear the stored WebAuthn challenge.
	 *
	 * @returns Challenge bytes if valid, otherwise null
	 */
	async #consumeChallenge() {
		const token = this.#c.cookie.get(this.#challengeCookie);

		this.#c.cookie.set(this.#challengeCookie, "", Passkey.#challengeOptions(0));

		if (token) {
			const payload = await this.#auth.verify(token);

			if (payload) return Codec.base64url.decode(payload);
		}

		return null;
	}

	/**
	 * Type predicate for client data JSON structure.
	 */
	static #isClientData(
		input: unknown,
	): input is { type: string; challenge: string; origin: string } {
		return (
			typeof input === "object" &&
			input !== null &&
			"type" in input &&
			typeof input.type === "string" &&
			"challenge" in input &&
			typeof input.challenge === "string" &&
			"origin" in input &&
			typeof input.origin === "string"
		);
	}

	/**
	 * Parse and validate client data JSON from base64url encoded string.
	 *
	 * @param data client data JSON
	 * @throws TypeError if client data is invalid
	 */
	#parseClientData(data: string) {
		const parsed: unknown = JSON.parse(
			Codec.decode(Codec.base64url.decode(data)),
		);

		if (!Passkey.#isClientData(parsed)) throw Passkey.#invalidCredential;

		return parsed;
	}

	/**
	 * Verify client data JSON matches expected values.
	 *
	 * @param clientData - Parsed client data JSON
	 * @param expectedType - Expected ceremony type (webauthn.create or webauthn.get)
	 * @param challenge - Expected challenge bytes
	 * @throws TypeError if ceremony type mismatch
	 * @throws Error if challenge or origin mismatch
	 */
	#verifyClientData(
		clientData: { type: string; challenge: string; origin: string },
		expectedType: string,
		challenge: Uint8Array,
	) {
		if (clientData.type !== expectedType) {
			throw new TypeError("Invalid ceremony type");
		}

		if (
			!Passkey.#timingSafeEqual(
				Codec.base64url.decode(clientData.challenge),
				challenge,
			)
		) {
			throw new Error("Challenge mismatch");
		}

		if (clientData.origin !== this.#c.url.origin) {
			throw new Error("Origin mismatch");
		}
	}

	static async #sha256(data: Uint8Array<ArrayBuffer>) {
		return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
	}

	/**
	 * Type predicate for base credential structure shared by registration and authentication.
	 */
	static #isCredentialBase(
		input: unknown,
	): input is {
		type: "public-key";
		id: string;
		rawId: string;
		response: { clientDataJSON: string };
	} {
		return (
			typeof input === "object" &&
			input !== null &&
			"type" in input &&
			input.type === "public-key" &&
			"id" in input &&
			typeof input.id === "string" &&
			"rawId" in input &&
			typeof input.rawId === "string" &&
			"response" in input &&
			typeof input.response === "object" &&
			input.response !== null &&
			"clientDataJSON" in input.response &&
			typeof input.response.clientDataJSON === "string"
		);
	}

	/**
	 * Type predicate for registration credential.
	 */
	static #isRegistrationCredential(
		input: unknown,
	): input is Passkey.RegistrationCredentialJSON {
		return (
			Passkey.#isCredentialBase(input) &&
			"attestationObject" in input.response &&
			typeof input.response.attestationObject === "string"
		);
	}

	/**
	 * Type predicate for authentication credential.
	 */
	static #isAuthenticationCredential(
		input: unknown,
	): input is Passkey.AuthenticationCredentialJSON {
		return (
			Passkey.#isCredentialBase(input) &&
			"authenticatorData" in input.response &&
			typeof input.response.authenticatorData === "string" &&
			"signature" in input.response &&
			typeof input.response.signature === "string"
		);
	}

	/**
	 * Common credential verification logic shared by verify() and assert().
	 *
	 * @param credential - Validated credential data from authenticator
	 * @param ceremonyType - Expected WebAuthn ceremony type
	 * @returns Decoded rawId bytes for further verification
	 */
	async #verifyCredentialBase(
		credential: {
			id: string;
			rawId: string;
			response: { clientDataJSON: string };
		},
		ceremonyType: "webauthn.create" | "webauthn.get",
	) {
		const rawIdBytes = Codec.base64url.decode(credential.rawId);

		if (
			!Passkey.#timingSafeEqual(
				Codec.base64url.decode(credential.id),
				rawIdBytes,
			)
		) {
			throw new Error("Credential ID mismatch");
		}

		const challenge = await this.#consumeChallenge();
		if (!challenge) throw new Error("Challenge expired or missing");

		this.#verifyClientData(
			this.#parseClientData(credential.response.clientDataJSON),
			ceremonyType,
			challenge,
		);

		return rawIdBytes;
	}

	/**
	 * Verify authenticator data flags and RP ID hash.
	 *
	 * @param authData - Parsed authenticator data
	 * @throws Error if RP ID mismatch, user not present, or user not verified
	 */
	async #verifyAuthData(authData: { rpIdHash: Uint8Array; flags: number }) {
		if (
			!Passkey.#timingSafeEqual(
				authData.rpIdHash,
				await Passkey.#sha256(Codec.encode(this.#rpId)),
			)
		) {
			throw new Error("RP ID mismatch");
		}

		if (!(authData.flags & 0x01)) {
			throw new Error("User not present");
		}

		if (!(authData.flags & 0x04)) {
			throw new Error("User not verified");
		}
	}

	/**
	 * Generate options for `navigator.credentials.create()`.
	 *
	 * @param user - User information for registration
	 * @param excludeCredentialIds - Optional list of credential IDs to exclude from registration. Prevents duplicate registration of the same authenticator.
	 * @returns WebAuthn credential creation options
	 */
	async create(
		user: Passkey.User,
		excludeCredentialIds?: string[],
	): Promise<PublicKeyCredentialCreationOptionsJSON> {
		return {
			challenge: await this.#newChallenge(),
			rp: { id: this.#rpId, name: this.#rpId },
			user: {
				id: Codec.base64url.encode(Codec.encode(user.id)),
				name: user.name,
				displayName: user.displayName,
			},
			pubKeyCredParams: [{ type: "public-key", alg: -7 }],
			excludeCredentials: excludeCredentialIds?.map((id) => ({
				type: "public-key",
				id,
				transports: ["internal", "hybrid"],
			})),
			authenticatorSelection: {
				residentKey: "preferred",
				userVerification: "required",
			},
			timeout: 300000,
			attestation: "none",
		};
	}

	/**
	 * Verify a registration response and return credential data to store.
	 *
	 * @param credential - Registration credential response from authenticator
	 * @returns Credential verification result containing ID and public key
	 * @throws TypeError if credential is not a valid credential
	 * @throws Error if challenge expired, RP ID mismatch, user not present, or credential data missing
	 */
	async verify(credential: unknown): Promise<Passkey.VerifyResult> {
		if (!Passkey.#isRegistrationCredential(credential)) {
			throw Passkey.#invalidCredential;
		}

		const rawIdBytes = await this.#verifyCredentialBase(
			credential,
			"webauthn.create",
		);

		const authData = AuthData.parse(
			new CBOR(
				Codec.base64url.decode(credential.response.attestationObject),
			).decodeAttestation(),
		);

		await this.#verifyAuthData(authData);

		if (!authData.attestedCredentialData) {
			throw new Error("Missing credential data");
		}

		if (
			!Passkey.#timingSafeEqual(
				authData.attestedCredentialData.credentialId,
				rawIdBytes,
			)
		) {
			throw new Error("Attested credential ID mismatch");
		}

		return {
			credentialId: Codec.base64url.encode(
				authData.attestedCredentialData.credentialId,
			),
			publicKey: Codec.base64url.encode(
				COSE.toSPKI(authData.attestedCredentialData.publicKey),
			),
		};
	}

	/**
	 * Generate options for `navigator.credentials.get()`.
	 *
	 * @returns WebAuthn credential request options
	 */
	async get(): Promise<PublicKeyCredentialRequestOptionsJSON> {
		return {
			challenge: await this.#newChallenge(),
			rpId: this.#rpId,
			timeout: 300000,
			userVerification: "required",
		};
	}

	/**
	 * Verify an authentication response and return the authenticated user ID.
	 *
	 * @param credential - Authentication credential response from authenticator
	 * @param stored - Stored credential data from database
	 * @returns Authentication assertion result containing credential ID and user ID
	 * @throws TypeError if credential is not a valid credential
	 * @throws Error if challenge expired, RP ID mismatch, user not present, or signature invalid
	 */
	async assert(
		credential: unknown,
		stored: Passkey.Credential,
	): Promise<Passkey.AssertResult> {
		if (!Passkey.#isAuthenticationCredential(credential)) {
			throw Passkey.#invalidCredential;
		}

		const rawIdBytes = await this.#verifyCredentialBase(
			credential,
			"webauthn.get",
		);

		const storedIdBytes = Codec.base64url.decode(stored.id);

		if (!Passkey.#timingSafeEqual(rawIdBytes, storedIdBytes)) {
			throw new Error("Credential ID mismatch");
		}

		const authDataBytes = Codec.base64url.decode(
			credential.response.authenticatorData,
		);
		const authData = AuthData.parse(authDataBytes);

		await this.#verifyAuthData(authData);

		const clientDataHash = await Passkey.#sha256(
			Codec.base64url.decode(credential.response.clientDataJSON),
		);

		const signedData = new Uint8Array(
			authDataBytes.length + clientDataHash.length,
		);
		signedData.set(authDataBytes);
		signedData.set(clientDataHash, authDataBytes.length);

		if (
			!(await crypto.subtle.verify(
				{ name: "ECDSA", hash: "SHA-256" },
				await crypto.subtle.importKey(
					"spki",
					Codec.base64url.decode(stored.publicKey),
					{ name: "ECDSA", namedCurve: "P-256" },
					false,
					["verify"],
				),
				DER.unwrap(Codec.base64url.decode(credential.response.signature)),
				signedData,
			))
		) {
			throw new Error("Invalid signature");
		}

		return {
			credentialId: Codec.base64url.encode(storedIdBytes),
			userId: stored.userId,
		};
	}
}

namespace AuthData {
	/** Attested credential public key data from authenticator */
	export type AttestedCredentialData = {
		/** Authenticator AAGUID */
		aaguid: Uint8Array;
		/** Credential ID bytes */
		credentialId: Uint8Array;
		/** COSE public key map */
		publicKey: Map<number, number | Uint8Array>;
	};
}

/** Parser for WebAuthn authenticator data structure */
class AuthData {
	/** RP ID hash length in bytes */
	static readonly #rpIdHashLength = 32;

	/** Byte offset of flags field */
	static readonly #flagsOffset = 32;

	/** Start byte offset of AAGUID */
	static readonly #aaguidStart = 37;

	/** End byte offset of AAGUID */
	static readonly #aaguidEnd = 53;

	/** Byte offset of credential ID length field */
	static readonly #credIdLengthOffset = 53;

	/** Credential ID length field size in bytes */
	static readonly #credIdLengthSize = 2;

	/** Start byte offset of credential ID data */
	static readonly #credIdStart = 55;

	/** Flag bit indicating attested credential data is present */
	static readonly #attestedCredentialFlag = 0x40;

	/**
	 * Parse authenticator data from binary format.
	 *
	 * @param data - Raw authenticator data bytes
	 * @returns Parsed authenticator data with flags, counters, and optional credential data
	 */
	static parse(data: Uint8Array) {
		const flags = data[AuthData.#flagsOffset];
		if (flags === undefined) {
			throw new TypeError("Invalid credential");
		}

		let attestedCredentialData: AuthData.AttestedCredentialData | null = null;

		if (flags & AuthData.#attestedCredentialFlag) {
			const credIdLen = new DataView(
				data.buffer,
				data.byteOffset + AuthData.#credIdLengthOffset,
				AuthData.#credIdLengthSize,
			).getUint16(0);

			attestedCredentialData = {
				aaguid: data.slice(AuthData.#aaguidStart, AuthData.#aaguidEnd),
				credentialId: data.slice(
					AuthData.#credIdStart,
					AuthData.#credIdStart + credIdLen,
				),
				publicKey: new CBOR(
					data.slice(AuthData.#credIdStart + credIdLen),
				).decodeCOSEKey(),
			};
		}

		return {
			rpIdHash: data.slice(0, AuthData.#rpIdHashLength),
			flags,
			attestedCredentialData,
		};
	}
}

/**
 * COSE (CBOR Object Signing and Encryption) key format utilities.
 */
class COSE {
	/** COSE key type label */
	static readonly #kty = 1;

	/** COSE key curve label */
	static readonly #crv = -1;

	/** COSE key X coordinate label */
	static readonly #x = -2;

	/** COSE key Y coordinate label */
	static readonly #y = -3;

	/** EC2 key type value */
	static readonly #ktyEc2 = 2;

	/** P-256 curve value */
	static readonly #crvP256 = 1;

	/** DER SPKI algorithm identifier for P-256 ECDSA */
	static readonly #algorithmId = new Uint8Array([
		0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06,
		0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
	]);

	/** Uncompressed point prefix byte for elliptic curves */
	static readonly #uncompressedPointPrefix = 0x04;

	/** Uncompressed point length for P-256 (1 + 32 + 32 bytes) */
	static readonly #uncompressedPointLength = 65;

	/** Offset of X coordinate in uncompressed point */
	static readonly #xCoordinateOffset = 1;

	/** Offset of Y coordinate in uncompressed point */
	static readonly #yCoordinateOffset = 33;

	/** DER BIT STRING tag */
	static readonly #bitStringTag = 0x03;

	/** DER SEQUENCE tag */
	static readonly #sequenceTag = 0x30;

	/** BIT STRING padding byte value */
	static readonly #bitStringPadding = 0x00;

	/**
	 * Convert COSE public key to SPKI format.
	 *
	 * @param cose - COSE key map with type, curve, and coordinates
	 * @returns SPKI encoded public key as bytes
	 * @throws Error if key type or curve not supported
	 */
	static toSPKI(cose: Map<number, number | Uint8Array>) {
		const kty = cose.get(COSE.#kty);
		if (kty !== COSE.#ktyEc2) throw new Error("Only EC2 keys supported");

		const crv = cose.get(COSE.#crv);
		if (crv !== COSE.#crvP256) throw new Error("Only P-256 supported");

		const x = cose.get(COSE.#x);
		const y = cose.get(COSE.#y);

		if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
			throw new Error("Invalid COSE key coordinates");
		}

		const uncompressed = new Uint8Array(COSE.#uncompressedPointLength);
		uncompressed[0] = COSE.#uncompressedPointPrefix;
		uncompressed.set(x, COSE.#xCoordinateOffset);
		uncompressed.set(y, COSE.#yCoordinateOffset);

		const bitString = new Uint8Array(3 + uncompressed.length);
		bitString[0] = COSE.#bitStringTag;
		bitString[1] = uncompressed.length + 1;
		bitString[2] = COSE.#bitStringPadding;
		bitString.set(uncompressed, 3);

		const spki = new Uint8Array(
			2 + COSE.#algorithmId.length + bitString.length,
		);
		spki[0] = COSE.#sequenceTag;
		spki[1] = COSE.#algorithmId.length + bitString.length;
		spki.set(COSE.#algorithmId, 2);
		spki.set(bitString, 2 + COSE.#algorithmId.length);

		return spki;
	}
}

/**
 * DER (Distinguished Encoding Rules) format utilities for signatures.
 */
class DER {
	/** DER SEQUENCE tag */
	static readonly #sequenceTag = 0x30;

	/** Flag bit indicating long form length encoding */
	static readonly #longFormLengthFlag = 0x80;

	/** Mask for extracting length bytes count in long form */
	static readonly #longFormLengthMask = 0x7f;

	/** P-256 coordinate length in bytes */
	static readonly #coordinateLength = 32;

	/** ECDSA raw signature length (r + s coordinates) */
	static readonly #signatureLength = 64;

	/**
	 * Convert DER encoded signature to raw format.
	 *
	 * @param der - DER encoded ECDSA signature
	 * @returns Raw signature (r and s coordinates concatenated)
	 */
	static unwrap(der: Uint8Array<ArrayBuffer>) {
		const view = new DataView(der.buffer, der.byteOffset, der.byteLength);

		if (view.getUint8(0) !== DER.#sequenceTag) return der;

		let offset = 2;

		if (view.getUint8(1) & DER.#longFormLengthFlag) {
			offset += view.getUint8(1) & DER.#longFormLengthMask;
		}

		const rLen = view.getUint8(offset + 1);
		let r = der.slice(offset + 2, offset + 2 + rLen);
		offset += 2 + rLen;

		const sLen = view.getUint8(offset + 1);
		let s = der.slice(offset + 2, offset + 2 + sLen);

		while (r.length > DER.#coordinateLength && r[0] === 0) r = r.slice(1);
		while (s.length > DER.#coordinateLength && s[0] === 0) s = s.slice(1);

		const raw = new Uint8Array(DER.#signatureLength);
		raw.set(r, DER.#signatureLength / 2 - r.length);
		raw.set(s, DER.#signatureLength - s.length);
		return raw;
	}
}

namespace CBOR {
	export type Key = number | string;
	export type Value = number | string | Uint8Array | Map<Key, Value>;
}

/** CBOR (Concise Binary Object Representation) decoder for WebAuthn data */
class CBOR {
	/** Encoded data to decode */
	readonly #data: Uint8Array;

	/** Current read position in data */
	#offset: number;

	/**
	 * Create a new CBOR instance
	 *
	 * @param data WebAuthn data
	 */
	constructor(data: Uint8Array) {
		this.#data = data;
		this.#offset = 0;
	}

	/**
	 * Decode attestation object and extract authenticator data.
	 *
	 * @returns Authenticator data bytes
	 * @throws TypeError if CBOR structure is invalid
	 */
	decodeAttestation() {
		const value = this.#parseNext();

		if (!(value instanceof Map)) throw new TypeError("Expected CBOR map");

		const fmt = value.get("fmt");

		if (fmt !== "none") {
			throw new TypeError("Unsupported attestation format");
		}

		const authData = value.get("authData");

		if (!(authData instanceof Uint8Array)) {
			throw new TypeError("Expected CBOR map");
		}

		return authData;
	}

	/**
	 * Decode COSE key from CBOR format.
	 *
	 * @returns COSE key map with numeric labels
	 * @throws TypeError if CBOR structure is invalid
	 */
	decodeCOSEKey() {
		const value = this.#parseNext();

		if (!(value instanceof Map)) {
			throw new TypeError("Expected CBOR map");
		}

		const result = new Map<number, number | Uint8Array>();

		for (const [k, v] of value) {
			if (typeof k !== "number") {
				throw new TypeError("COSE key must have integer labels");
			}

			if (typeof v !== "number" && !(v instanceof Uint8Array)) {
				throw new TypeError("COSE key value must be number or bytes");
			}

			result.set(k, v);
		}

		return result;
	}

	/**
	 * Read n bytes and advance offset.
	 *
	 * @param n - Number of bytes to read
	 * @returns Slice of data
	 */
	#read(n: number) {
		return this.#data.slice(this.#offset, (this.#offset += n));
	}

	/**
	 * Read unsigned integer from n bytes.
	 *
	 * @param bytes - Number of bytes to read
	 * @returns Decoded unsigned integer
	 * @throws Error if stream ended unexpectedly
	 */
	#readUint(bytes: number) {
		if (this.#offset + bytes > this.#data.length) {
			throw new Error("CBOR stream ended unexpectedly");
		}

		let value = 0;
		for (let i = 0; i < bytes; i++) {
			value = value * 256 + this.#data[this.#offset++]!;
		}

		return value;
	}

	/**
	 * Parse next CBOR value from stream.
	 *
	 * @returns Decoded value (primitives, Uint8Array, or Map)
	 * @throws Error if stream is malformed
	 */
	#parseNext(): CBOR.Value {
		if (this.#offset >= this.#data.length) {
			throw new Error("CBOR stream ended unexpectedly");
		}

		const initial = this.#data[this.#offset++]!;
		const major = initial >> 5;
		const minor = initial & 0x1f;

		let length: number;
		if (minor < 24) {
			length = minor;
		} else if (minor === 24) {
			length = this.#readUint(1);
		} else if (minor === 25) {
			length = this.#readUint(2);
		} else if (minor === 26) {
			length = this.#readUint(4);
		} else {
			throw new Error("CBOR: unsupported length");
		}

		if (major === 0) return length;
		if (major === 1) return -1 - length;
		if (major === 2) return this.#read(length);
		if (major === 3) return Codec.decode(this.#read(length));
		if (major === 5) {
			const map = new Map<CBOR.Key, CBOR.Value>();

			for (let i = 0; i < length; i++) {
				const k = this.#parseNext();

				if (typeof k !== "number" && typeof k !== "string") {
					throw new TypeError("CBOR map key must be number or string");
				}

				map.set(k, this.#parseNext());
			}

			return map;
		}

		throw new TypeError(`CBOR: unsupported major type ${major}`);
	}
}
