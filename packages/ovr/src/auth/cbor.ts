import { Codec } from "../util/index.js";
import { AuthIssue } from "./issue.js";

/** COSE (CBOR Object Signing and Encryption) key format utilities */
export class COSE {
	/** DER SPKI algorithm identifier for P-256 ECDSA */
	static readonly #algorithmId = new Uint8Array([
		0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06,
		0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
	]);

	/**
	 * Convert COSE public key to SPKI format.
	 *
	 * Only EC2 keys with P-256 curve (ES256, alg -7) are supported. This is the standard modern algorithm
	 * supported by virtually all platform authenticators (https://www.rfc-editor.org/rfc/rfc8152#section-8.1).
	 *
	 * @param cose - COSE key map with type, curve, and coordinates
	 * @returns SPKI encoded public key as bytes
	 * @throws Auth.Issue if key type, curve, or coordinates are invalid
	 */
	static toSPKI(cose: Map<number, number | Uint8Array>) {
		const kty = cose.get(1); // COSE label 1 = kty
		if (kty !== 2) throw new AuthIssue("COSE type");

		const crv = cose.get(-1); // COSE label -1 = crv
		if (crv !== 1) throw new AuthIssue("COSE curve");

		const x = cose.get(-2); // COSE label -2 = x coordinate
		const y = cose.get(-3); // COSE label -3 = y coordinate

		if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) {
			throw new AuthIssue("COSE coordinates");
		}

		const uncompressed = new Uint8Array(65); // 0x04 || X(32) || Y(32)
		uncompressed[0] = 0x04; // uncompressed EC point prefix
		uncompressed.set(x, 1); // X coordinate offset
		uncompressed.set(y, 33); // Y coordinate offset

		const bitString = new Uint8Array(3 + uncompressed.length);
		bitString[0] = 0x03; // DER BIT STRING tag
		bitString[1] = uncompressed.length + 1;
		bitString[2] = 0x00; // BIT STRING unused-bits count
		bitString.set(uncompressed, 3);

		const spki = new Uint8Array(
			2 + COSE.#algorithmId.length + bitString.length,
		);
		spki[0] = 0x30; // DER SEQUENCE tag
		spki[1] = COSE.#algorithmId.length + bitString.length;
		spki.set(COSE.#algorithmId, 2);
		spki.set(bitString, 2 + COSE.#algorithmId.length);

		return spki;
	}
}

export namespace CBOR {
	export type Key = number | string;
	export type Value = number | string | Uint8Array | Map<Key, Value>;
}

/** CBOR (Concise Binary Object Representation) decoder for WebAuthn data */
export class CBOR {
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
	 * Only supports fmt === "none", other formats may throw earlier depending on CBOR contents
	 *
	 * @returns Authenticator data bytes
	 * @throws Auth.Issue if CBOR structure is invalid
	 */
	decodeAttestation() {
		const value = this.#parseNext();

		if (value instanceof Map) {
			const authData = value.get("authData");

			if (value.get("fmt") === "none" && authData instanceof Uint8Array) {
				return authData;
			}
		}

		throw new AuthIssue("credential");
	}

	/**
	 * Decode COSE key from CBOR format.
	 *
	 * @returns COSE key map with numeric labels
	 * @throws Auth.Issue if CBOR structure is invalid
	 */
	decodeCOSEKey() {
		const value = this.#parseNext();

		if (!(value instanceof Map)) {
			throw new AuthIssue("CBOR map");
		}

		const result = new Map<number, number | Uint8Array>();

		for (const [k, v] of value) {
			if (typeof k !== "number") {
				throw new AuthIssue("COSE labels");
			}

			if (typeof v !== "number" && !(v instanceof Uint8Array)) {
				throw new AuthIssue("COSE value");
			}

			result.set(k, v);
		}

		return result;
	}

	/**
	 * Read n bytes and advance offset.
	 *
	 * @param n - Number of bytes to read
	 * @returns Subarray of data
	 */
	#read(n: number) {
		const end = this.#offset + n;

		if (end > this.#data.length) {
			throw new AuthIssue("CBOR stream");
		}

		return this.#data.subarray(this.#offset, (this.#offset = end));
	}

	/**
	 * Read unsigned integer from n bytes using DataView.
	 *
	 * @param bytes - Number of bytes to read (1, 2, or 4)
	 * @returns Decoded unsigned integer
	 * @throws Auth.Issue if stream or integer size is invalid
	 */
	#readUint(bytes: number) {
		if (this.#offset + bytes > this.#data.length) {
			throw new AuthIssue("CBOR stream");
		}

		const view = new DataView(
			this.#data.buffer,
			this.#data.byteOffset + this.#offset,
			bytes,
		);

		this.#offset += bytes;

		switch (bytes) {
			case 1:
				return view.getUint8(0);
			case 2:
				return view.getUint16(0, false);
			case 4:
				return view.getUint32(0, false);
			default:
				throw new AuthIssue("CBOR int");
		}
	}

	/**
	 * Parse next CBOR value from stream.
	 *
	 * @returns Decoded value (primitives, Uint8Array, or Map)
	 * @throws Auth.Issue if stream is malformed
	 */
	#parseNext(): CBOR.Value {
		if (this.#offset >= this.#data.length) {
			throw new AuthIssue("CBOR stream");
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
			throw new AuthIssue("CBOR length");
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
					throw new AuthIssue("CBOR key");
				}

				map.set(k, this.#parseNext());
			}

			return map;
		}

		throw new AuthIssue(`CBOR type ${major}`);
	}
}
