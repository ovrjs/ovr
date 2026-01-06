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
		const expected = new Uint8Array(
			await crypto.subtle.digest("SHA-256", Codec.encode(this.#rpId)),
		);
		if (!Crypto.timingSafeEqual(hash, expected)) {
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
			!Crypto.timingSafeEqual(
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
	): Promise<PublicKeyCredentialCreationOptions> {
		const challenge = crypto.getRandomValues(new Uint8Array(32));
		await this.#setChallenge(challenge);

		return {
			challenge,
			rp: { id: this.#rpId, name: this.#rpId },
			user: {
				id: Codec.base64url.decode(
					Codec.base64url.encode(Codec.encode(user.id)),
				),
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
	async verify(credential: unknown): Promise<PublicKey.VerifyResult> {
		const cred = credential as {
			id: string;
			response: {
				clientDataJSON: string;
				attestationObject: string;
				publicKey?: string;
			};
		};

		const challenge = await this.#consumeChallenge();
		if (!challenge) throw new Error("Challenge expired or missing");

		const clientData = JSON.parse(
			Codec.decode(Codec.base64url.decode(cred.response.clientDataJSON)),
		) as { type: string; challenge: string; origin: string };

		this.#verifyClientData(clientData, "webauthn.create", challenge);

		const attestation = CBOR.decode(
			Codec.base64url.decode(cred.response.attestationObject),
		) as { authData: Uint8Array };

		const authData = AuthData.parse(attestation.authData);

		await this.#verifyRpIdHash(authData.rpIdHash);

		if (!(authData.flags & 0x01)) {
			throw new Error("User not present");
		}
		if (!authData.attestedCredentialData) {
			throw new Error("Missing credential data");
		}

		let publicKey: string;
		if (cred.response.publicKey) {
			publicKey = cred.response.publicKey;
		} else {
			publicKey = Codec.base64url.encode(
				COSE.toSpki(authData.attestedCredentialData.publicKey),
			);
		}

		return { credentialId: cred.id, publicKey, counter: authData.signCount };
	}

	/** Generate options for `navigator.credentials.get()`. */
	async get(): Promise<PublicKeyCredentialRequestOptions> {
		const challenge = crypto.getRandomValues(new Uint8Array(32));

		await this.#setChallenge(challenge);

		return {
			challenge,
			rpId: this.#rpId,
			timeout: 300000,
			userVerification: "preferred" as const,
		};
	}

	/** Verify an authentication response and create a session. */
	async assert(
		credential: unknown,
		stored: PublicKey.Credential,
	): Promise<PublicKey.AssertResult> {
		const cred = credential as {
			id: string;
			response: {
				clientDataJSON: string;
				authenticatorData: string;
				signature: string;
			};
		};

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
			DER.unwrapSignature(Codec.base64url.decode(cred.response.signature)),
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

class Crypto {
	static timingSafeEqual(a: Uint8Array, b: Uint8Array) {
		if (a.length !== b.length) return false;
		let result = 0;
		for (let i = 0; i < a.length; i++) result |= a[i]! ^ b[i]!;
		return result === 0;
	}
}

class AuthData {
	static parse(data: Uint8Array) {
		const rpIdHash = data.slice(0, 32);
		const flags = data[32]!;
		const signCount = new DataView(
			data.buffer,
			data.byteOffset + 33,
			4,
		).getUint32(0);

		let attestedCredentialData: {
			aaguid: Uint8Array;
			credentialId: Uint8Array;
			publicKey: Map<number, unknown>;
		} | null = null;

		if (flags & 0x40) {
			const aaguid = data.slice(37, 53);
			const credIdLen = new DataView(
				data.buffer,
				data.byteOffset + 53,
				2,
			).getUint16(0);
			const credentialId = data.slice(55, 55 + credIdLen);
			const publicKey = CBOR.decode(data.slice(55 + credIdLen)) as Map<
				number,
				unknown
			>;
			attestedCredentialData = { aaguid, credentialId, publicKey };
		}

		return { rpIdHash, flags, signCount, attestedCredentialData };
	}
}

class COSE {
	static toSpki(cose: Map<number, unknown>) {
		const kty = cose.get(1);
		if (kty !== 2) throw new Error("Only EC2 keys supported");

		const crv = cose.get(-1);
		if (crv !== 1) throw new Error("Only P-256 supported");

		const x = cose.get(-2) as Uint8Array;
		const y = cose.get(-3) as Uint8Array;

		const uncompressed = new Uint8Array(65);
		uncompressed[0] = 0x04;
		uncompressed.set(x, 1);
		uncompressed.set(y, 33);

		// OID 1.2.840.10045.2.1 (ecPublicKey) + 1.2.840.10045.3.1.7 (prime256v1)
		const algorithmId = new Uint8Array([
			0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06,
			0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
		]);

		const bitString = new Uint8Array(3 + uncompressed.length);
		bitString[0] = 0x03;
		bitString[1] = uncompressed.length + 1;
		bitString[2] = 0x00;
		bitString.set(uncompressed, 3);

		const spki = new Uint8Array(2 + algorithmId.length + bitString.length);
		spki[0] = 0x30;
		spki[1] = algorithmId.length + bitString.length;
		spki.set(algorithmId, 2);
		spki.set(bitString, 2 + algorithmId.length);

		return spki;
	}
}

class DER {
	static unwrapSignature(der: Uint8Array<ArrayBuffer>) {
		if (der[0] !== 0x30) return der;

		let offset = 2;
		if (der[1]! & 0x80) offset += der[1]! & 0x7f;

		const rLen = der[offset + 1]!;
		let r = der.slice(offset + 2, offset + 2 + rLen);
		offset += 2 + rLen;

		const sLen = der[offset + 1]!;
		let s = der.slice(offset + 2, offset + 2 + sLen);

		while (r.length > 32 && r[0] === 0) r = r.slice(1);
		while (s.length > 32 && s[0] === 0) s = s.slice(1);

		const raw = new Uint8Array(64);
		raw.set(r, 32 - r.length);
		raw.set(s, 64 - s.length);
		return raw;
	}
}

class CBOR {
	static decode(data: Uint8Array): unknown {
		let offset = 0;

		const read = (n: number) => {
			const slice = data.slice(offset, offset + n);
			offset += n;
			return slice;
		};

		const readUint = (bytes: number) => {
			let value = 0;
			for (let i = 0; i < bytes; i++) value = value * 256 + data[offset++]!;
			return value;
		};

		const parse = (): unknown => {
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
				case 4: {
					const arr: unknown[] = [];
					for (let i = 0; i < length; i++) arr.push(parse());
					return arr;
				}
				case 5: {
					const map = new Map<unknown, unknown>();
					for (let i = 0; i < length; i++) map.set(parse(), parse());
					return map;
				}
				default:
					throw new Error(`CBOR: unsupported major type ${major}`);
			}
		};

		return parse();
	}
}
