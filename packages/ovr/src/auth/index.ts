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

	export type Session = { readonly id: string; readonly expiration: number };
}

/**
 * Stateless authentication helper with passkey support.
 */
export class Auth {
	static readonly #keys = new Map<string, Promise<CryptoKey>>();

	readonly #c: Context;
	readonly options;
	readonly publicKey: PublicKey;

	constructor(c: Context, options: Auth.Options) {
		this.#c = c;
		this.options = Object.assign(
			{
				cookie: "__Host-session",
				duration: Time.week,
				refresh: (options.duration ?? Time.week) / 4,
			},
			options,
		) satisfies Omit<Auth.Options, "secret">;
		this.publicKey = new PublicKey(c, this);
	}

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

	async sign(payload: string) {
		return `${payload}.${Codec.base64.encode(
			new Uint8Array(
				await crypto.subtle.sign(
					"HMAC",
					await this.#key,
					Codec.encode(payload),
				),
			),
		)}`;
	}

	async verifySignature(token: string) {
		const [payload, sig] = token.split(".", 2);
		if (payload && sig) {
			try {
				if (
					await crypto.subtle.verify(
						"HMAC",
						await this.#key,
						Codec.base64.decode(sig),
						Codec.encode(payload),
					)
				) {
					return payload;
				}
			} catch {}
		}
		return null;
	}

	#setCookie(session: Auth.Session): Promise<Auth.Session>;
	#setCookie(session?: undefined): Promise<null>;
	async #setCookie(session?: Auth.Session) {
		this.#c.cookie.set(
			this.options.cookie,
			session
				? await this.sign(
						Codec.base64.encode(Codec.encode(JSON.stringify(session))),
					)
				: "",
			{
				httpOnly: true,
				secure: true,
				sameSite: "Lax",
				maxAge: session ? Math.floor(this.options.duration / 1000) : 0,
			},
		);

		return session ?? null;
	}

	async session() {
		const token = this.#c.cookie.get(this.options.cookie);
		if (!token) return null;

		const payload = await this.verifySignature(token);
		if (payload) {
			try {
				const session = JSON.parse(
					Codec.decode(Codec.base64.decode(payload)),
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

	login(id: string) {
		return this.#setCookie({
			id,
			expiration: Date.now() + this.options.duration,
		});
	}

	logout() {
		return this.#setCookie();
	}
}

export namespace PublicKey {
	type ToJSON<T> = {
		[K in keyof T]: T[K] extends ArrayBuffer | Uint8Array | BufferSource
			? Base64URLString
			: T[K];
	};

	type CredentialJSON<TResponse> = {
		id: Base64URLString;
		rawId: Base64URLString;
		type: "public-key";
		response: TResponse;
	};

	export type RegistrationCredentialJSON = CredentialJSON<
		ToJSON<AuthenticatorAttestationResponse> & { publicKey?: Base64URLString }
	>;

	export type AuthenticationCredentialJSON = CredentialJSON<
		ToJSON<AuthenticatorAssertionResponse>
	>;

	export type User = { id: string; name: string; displayName: string };

	export type Credential = {
		id: string;
		publicKey: string;
		userId: string;
		counter: number;
	};

	export type VerifyResult = {
		credentialId: string;
		publicKey: string;
		counter: number;
	};

	export type AssertResult = {
		credentialId: string;
		userId: string;
		counter: number;
	};
}

/**
 * WebAuthn passkey authentication.
 */
export class PublicKey {
	readonly #auth: Auth;
	readonly #c: Context;
	readonly #challengeCookie: string;

	constructor(c: Context, auth: Auth) {
		this.#c = c;
		this.#auth = auth;
		this.#challengeCookie = `${this.#auth.options.cookie}-challenge`;
	}

	static #timingSafeEqual(a: Uint8Array, b: Uint8Array) {
		if (a.length !== b.length) return false;
		let result = 0;
		for (let i = 0; i < a.length; i++) result |= a[i]! ^ b[i]!;
		return result === 0;
	}

	get #rpId() {
		return this.#c.url.hostname;
	}

	async #setChallenge(challenge: Uint8Array) {
		this.#c.cookie.set(
			this.#challengeCookie,
			await this.#auth.sign(Codec.base64url.encode(challenge)),
			{ httpOnly: true, secure: true, sameSite: "Strict", maxAge: 300 },
		);
	}

	async #consumeChallenge() {
		const token = this.#c.cookie.get(this.#challengeCookie);

		this.#c.cookie.set(this.#challengeCookie, "", {
			httpOnly: true,
			secure: true,
			sameSite: "Strict",
			maxAge: 0,
		});

		if (token) {
			const payload = await this.#auth.verifySignature(token);
			if (payload) return Codec.base64url.decode(payload);
		}

		return null;
	}

	async #verifyRpIdHash(hash: Uint8Array) {
		if (
			!PublicKey.#timingSafeEqual(
				hash,
				new Uint8Array(
					await crypto.subtle.digest("SHA-256", Codec.encode(this.#rpId)),
				),
			)
		) {
			throw new Error("RP ID mismatch");
		}
	}

	#verifyClientData(
		clientData: { type: string; challenge: string; origin: string },
		expectedType: string,
		challenge: Uint8Array,
	) {
		if (clientData.type !== expectedType) {
			throw new TypeError("Invalid ceremony type");
		}

		if (
			!PublicKey.#timingSafeEqual(
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

	/** Generate options for `navigator.credentials.create()`. */
	async create(
		user: PublicKey.User,
	): Promise<PublicKeyCredentialCreationOptionsJSON> {
		const challenge = crypto.getRandomValues(new Uint8Array(32));

		await this.#setChallenge(challenge);

		return {
			challenge: Codec.base64url.encode(challenge),
			rp: { id: this.#rpId, name: this.#rpId },
			user: {
				id: Codec.base64url.encode(Codec.encode(user.id)),
				name: user.name,
				displayName: user.displayName,
			},
			pubKeyCredParams: [
				{ type: "public-key" as const, alg: -7 },
				{ type: "public-key" as const, alg: -257 },
			],
			authenticatorSelection: {
				residentKey: "preferred" as const,
				userVerification: "preferred" as const,
			},
			timeout: 300000,
			attestation: "none" as const,
		};
	}

	/** Verify a registration response and return credential data to store. */
	async verify(
		credential: PublicKey.RegistrationCredentialJSON,
	): Promise<PublicKey.VerifyResult> {
		const challenge = await this.#consumeChallenge();
		if (!challenge) throw new Error("Challenge expired or missing");

		const clientData = JSON.parse(
			Codec.decode(Codec.base64url.decode(credential.response.clientDataJSON)),
		);

		this.#verifyClientData(clientData, "webauthn.create", challenge);

		const attestation = CBOR.decodeAttestation(
			Codec.base64url.decode(credential.response.attestationObject),
		);

		const authData = AuthData.parse(attestation.authData);

		await this.#verifyRpIdHash(authData.rpIdHash);

		if (!(authData.flags & 0x01)) {
			throw new Error("User not present");
		}
		if (!authData.attestedCredentialData) {
			throw new Error("Missing credential data");
		}

		return {
			credentialId: credential.id,
			publicKey:
				credential.response.publicKey ??
				Codec.base64url.encode(
					COSE.toSpki(authData.attestedCredentialData.publicKey),
				),
			counter: authData.signCount,
		};
	}

	/** Generate options for `navigator.credentials.get()`. */
	async get(): Promise<PublicKeyCredentialRequestOptionsJSON> {
		const challenge = crypto.getRandomValues(new Uint8Array(32));

		await this.#setChallenge(challenge);

		return {
			challenge: Codec.base64url.encode(challenge),
			rpId: this.#rpId,
			timeout: 300000,
			userVerification: "preferred" as const,
		};
	}

	/** Verify an authentication response and create a session. */
	async assert(
		credential: PublicKey.AuthenticationCredentialJSON,
		stored: PublicKey.Credential,
	): Promise<PublicKey.AssertResult> {
		const cred = credential;

		const challenge = await this.#consumeChallenge();
		if (!challenge) throw new Error("Challenge expired or missing");

		const clientDataJSON = Codec.base64url.decode(cred.response.clientDataJSON);
		const clientData = JSON.parse(Codec.decode(clientDataJSON)) as {
			type: string;
			challenge: string;
			origin: string;
		};

		this.#verifyClientData(clientData, "webauthn.get", challenge);

		const authDataBytes = Codec.base64url.decode(
			cred.response.authenticatorData,
		);
		const authData = AuthData.parse(authDataBytes);

		await this.#verifyRpIdHash(authData.rpIdHash);

		if (!(authData.flags & 0x01)) {
			throw new Error("User not present");
		}
		if (authData.signCount > 0 && authData.signCount <= stored.counter) {
			throw new Error("Possible credential clone detected");
		}

		const clientDataHash = new Uint8Array(
			await crypto.subtle.digest("SHA-256", clientDataJSON),
		);
		const signedData = new Uint8Array(
			authDataBytes.length + clientDataHash.length,
		);
		signedData.set(authDataBytes);
		signedData.set(clientDataHash, authDataBytes.length);

		const publicKey = await crypto.subtle.importKey(
			"spki",
			Codec.base64url.decode(stored.publicKey),
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"],
		);

		const valid = await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			publicKey,
			DER.unwrap(Codec.base64url.decode(cred.response.signature)),
			signedData,
		);

		if (!valid) throw new Error("Invalid signature");

		await this.#auth.login(stored.userId);

		return {
			credentialId: cred.id,
			userId: stored.userId,
			counter: authData.signCount,
		};
	}
}

namespace AuthData {
	export type AttestedCredentialData = {
		aaguid: Uint8Array;
		credentialId: Uint8Array;
		publicKey: Map<number, number | Uint8Array>;
	};
}

class AuthData {
	static readonly #rpIdHashLength = 32;
	static readonly #flagsOffset = 32;
	static readonly #signCountOffset = 33;
	static readonly #signCountLength = 4;
	static readonly #aaguidStart = 37;
	static readonly #aaguidEnd = 53;
	static readonly #credIdLengthOffset = 53;
	static readonly #credIdLengthSize = 2;
	static readonly #credIdStart = 55;
	static readonly #attestedCredentialFlag = 0x40;

	static parse(data: Uint8Array) {
		const flags = data[this.#flagsOffset]!;

		let attestedCredentialData: AuthData.AttestedCredentialData | null = null;

		if (flags & this.#attestedCredentialFlag) {
			const credIdLen = new DataView(
				data.buffer,
				data.byteOffset + this.#credIdLengthOffset,
				this.#credIdLengthSize,
			).getUint16(0);

			attestedCredentialData = {
				aaguid: data.slice(this.#aaguidStart, this.#aaguidEnd),
				credentialId: data.slice(
					this.#credIdStart,
					this.#credIdStart + credIdLen,
				),
				publicKey: CBOR.decodeCOSEKey(
					data.slice(this.#credIdStart + credIdLen),
				),
			};
		}

		return {
			rpIdHash: data.slice(0, this.#rpIdHashLength),
			flags,
			signCount: new DataView(
				data.buffer,
				data.byteOffset + this.#signCountOffset,
				this.#signCountLength,
			).getUint32(0),
			attestedCredentialData,
		};
	}
}

class COSE {
	// COSE key labels
	static readonly #kty = 1;
	static readonly #crv = -1;
	static readonly #x = -2;
	static readonly #y = -3;

	// COSE key type values
	static readonly #ktyEc2 = 2;
	static readonly #crvP256 = 1;

	// SPKI encoding constants
	static readonly #algorithmId = new Uint8Array([
		0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06,
		0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
	]);

	static readonly #uncompressedPointPrefix = 0x04;
	static readonly #uncompressedPointLength = 65;
	static readonly #xCoordinateOffset = 1;
	static readonly #yCoordinateOffset = 33;

	static readonly #bitStringTag = 0x03;
	static readonly #sequenceTag = 0x30;
	static readonly #bitStringPadding = 0x00;

	static toSpki(cose: Map<number, number | Uint8Array>) {
		const kty = cose.get(this.#kty);
		if (kty !== this.#ktyEc2) throw new Error("Only EC2 keys supported");

		const crv = cose.get(this.#crv);
		if (crv !== this.#crvP256) throw new Error("Only P-256 supported");

		const x = cose.get(this.#x);
		const y = cose.get(this.#y);

		if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
			throw new Error("Invalid COSE key coordinates");
		}

		const uncompressed = new Uint8Array(this.#uncompressedPointLength);
		uncompressed[0] = this.#uncompressedPointPrefix;
		uncompressed.set(x, this.#xCoordinateOffset);
		uncompressed.set(y, this.#yCoordinateOffset);

		const bitString = new Uint8Array(3 + uncompressed.length);
		bitString[0] = this.#bitStringTag;
		bitString[1] = uncompressed.length + 1;
		bitString[2] = this.#bitStringPadding;
		bitString.set(uncompressed, 3);

		const spki = new Uint8Array(
			2 + this.#algorithmId.length + bitString.length,
		);
		spki[0] = this.#sequenceTag;
		spki[1] = this.#algorithmId.length + bitString.length;
		spki.set(this.#algorithmId, 2);
		spki.set(bitString, 2 + this.#algorithmId.length);

		return spki;
	}
}

class DER {
	static readonly #sequenceTag = 0x30;
	static readonly #longFormLengthFlag = 0x80;
	static readonly #longFormLengthMask = 0x7f;
	static readonly #coordinateLength = 32;
	static readonly #signatureLength = 64;

	static unwrap(der: Uint8Array<ArrayBuffer>) {
		const view = new DataView(der.buffer, der.byteOffset, der.byteLength);

		if (view.getUint8(0) !== this.#sequenceTag) return der;

		let offset = 2;
		if (view.getUint8(1) & this.#longFormLengthFlag)
			offset += view.getUint8(1) & this.#longFormLengthMask;

		const rLen = view.getUint8(offset + 1);
		let r = der.slice(offset + 2, offset + 2 + rLen);
		offset += 2 + rLen;

		const sLen = view.getUint8(offset + 1);
		let s = der.slice(offset + 2, offset + 2 + sLen);

		while (r.length > this.#coordinateLength && r[0] === 0) r = r.slice(1);
		while (s.length > this.#coordinateLength && s[0] === 0) s = s.slice(1);

		const raw = new Uint8Array(this.#signatureLength);
		raw.set(r, this.#signatureLength / 2 - r.length);
		raw.set(s, this.#signatureLength - s.length);
		return raw;
	}
}

namespace CBOR {
	export type Key = number | string;
	export type Value = number | string | Uint8Array | Map<Key, Value>;
}

class CBOR {
	static decodeAttestation(data: Uint8Array) {
		const value = CBOR.#parse(data);

		if (!(value instanceof Map)) {
			throw new TypeError("Expected CBOR map");
		}

		const authData = value.get("authData") ?? value.get(0x22);

		if (!(authData instanceof Uint8Array)) {
			throw new TypeError("Expected CBOR map");
		}

		return { authData };
	}

	static decodeCOSEKey(data: Uint8Array): Map<number, number | Uint8Array> {
		const value = CBOR.#parse(data);

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

	static #parse(data: Uint8Array) {
		let offset = 0;

		const read = (n: number) => {
			const slice = data.slice(offset, offset + n);
			offset += n;
			return slice;
		};

		const readUint = (bytes: number) => {
			if (offset + bytes > data.length) {
				throw new Error("CBOR stream ended unexpectedly");
			}
			let value = 0;
			for (let i = 0; i < bytes; i++) value = value * 256 + data[offset++]!;
			return value;
		};

		const parse = () => {
			if (offset >= data.length) {
				throw new Error("CBOR stream ended unexpectedly");
			}

			const initial = data[offset++]!;
			const major = initial >> 5;
			const minor = initial & 0x1f;

			let length: number;
			if (minor < 24) length = minor;
			else if (minor === 24) length = readUint(1);
			else if (minor === 25) length = readUint(2);
			else if (minor === 26) length = readUint(4);
			else throw new Error("CBOR: unsupported length");

			switch (major) {
				case 0:
					return length;
				case 1:
					return -1 - length;
				case 2:
					return read(length);
				case 3:
					return Codec.decode(read(length));
				case 5: {
					const map = new Map<CBOR.Key, CBOR.Value>();

					for (let i = 0; i < length; i++) {
						const k = parse();

						if (typeof k !== "number" && typeof k !== "string") {
							throw new TypeError("CBOR map key must be number or string");
						}

						map.set(k, parse());
					}

					return map;
				}
				default:
					throw new Error(`CBOR: unsupported major type ${major}`);
			}
		};

		return parse();
	}
}
