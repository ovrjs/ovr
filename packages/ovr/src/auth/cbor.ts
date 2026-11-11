import { Codec } from "../util/index.js";
import { Issue } from "./issue.js";

/** COSE (CBOR Object Signing and Encryption) key format utilities */
export class COSE {
	/** Fixed SPKI header for an uncompressed P-256 point. */
	static readonly #prefix = new Uint8Array([
		0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
		0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
		0x42, 0x00, 0x04,
	]);

	/**
	 * Convert COSE public key to SPKI format.
	 *
	 * Only EC2 keys with P-256 curve (ES256, alg -7) are supported. This is the standard modern algorithm
	 * supported by virtually all platform authenticators (https://www.rfc-editor.org/rfc/rfc8152#section-8.1).
	 *
	 * @param cose - COSE key map with type, curve, and coordinates
	 * @returns SPKI encoded public key as bytes
	 * @throws Issue if key type, curve, or coordinates are invalid
	 */
	static toSPKI(cose: Map<number, number | Uint8Array>) {
		if (cose.get(1) !== 2) throw new Issue("COSE type");
		if (cose.get(-1) !== 1) throw new Issue("COSE curve");
		if (cose.get(3) !== -7) throw new Issue("COSE algorithm");

		const x = cose.get(-2); // COSE label -2 = x coordinate
		const y = cose.get(-3); // COSE label -3 = y coordinate

		if (
			!(x instanceof Uint8Array) ||
			!(y instanceof Uint8Array) ||
			x.length !== 32 ||
			y.length !== 32
		)
			throw new Issue("COSE coordinates");

		return new Uint8Array([...COSE.#prefix, ...x, ...y]);
	}
}

export namespace CBOR {
	export type Key = number | string;
	export type Value =
		number | string | boolean | null | Uint8Array | Map<Key, Value> | Value[];
}

/** CBOR (Concise Binary Object Representation) decoder for WebAuthn data */
export class CBOR {
	/** Encoded data to decode */
	readonly #data: Uint8Array;

	/** Current read position in data */
	#offset = 0;

	/**
	 * Create a new CBOR instance
	 *
	 * @param data WebAuthn data
	 */
	constructor(data: Uint8Array) {
		if (data.length > 65536) throw new Issue("CBOR size");
		this.#data = data;
	}

	/**
	 * Decode attestation object and extract authenticator data.
	 *
	 * Only supports fmt === "none", other formats may throw earlier depending on CBOR contents
	 *
	 * @returns Authenticator data bytes
	 * @throws Issue if CBOR structure is invalid
	 */
	decodeAttestation() {
		const value = this.#parseNext();

		if (value instanceof Map) {
			const authData = value.get("authData");

			const statement = value.get("attStmt");
			if (
				value.get("fmt") === "none" &&
				authData instanceof Uint8Array &&
				statement instanceof Map &&
				statement.size === 0 &&
				this.#offset === this.#data.length
			) {
				return authData;
			}
		}

		throw new Issue("credential");
	}

	/**
	 * Decode COSE key from CBOR format.
	 *
	 * @returns COSE key map with numeric labels
	 * @throws Issue if CBOR structure is invalid
	 */
	decodeCOSEKey() {
		const value = this.#parseNext();

		if (!(value instanceof Map)) {
			throw new Issue("CBOR map");
		}

		const result = new Map<number, number | Uint8Array>();

		for (const [k, v] of value) {
			if (typeof k !== "number") {
				throw new Issue("COSE labels");
			}

			if (typeof v !== "number" && !(v instanceof Uint8Array)) {
				throw new Issue("COSE value");
			}

			result.set(k, v);
		}

		return result;
	}

	/** Bytes consumed by the last decoded value. */
	get offset() {
		return this.#offset;
	}

	/** Decode authenticator extensions as a CBOR map. */
	decodeExtensions() {
		const value = this.#parseNext();
		if (
			!(value instanceof Map) ||
			[...value.keys()].some((key) => typeof key !== "string")
		)
			throw new Issue("CBOR extensions");
		return value;
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
			throw new Issue("CBOR stream");
		}

		return this.#data.subarray(this.#offset, (this.#offset = end));
	}

	/**
	 * Read a big-endian unsigned integer from n bytes.
	 *
	 * @param bytes - Number of bytes to read (1, 2, or 4)
	 * @returns Decoded unsigned integer
	 * @throws Issue if the stream ends first
	 */
	#readUint(bytes: number) {
		let value = 0;
		for (const byte of this.#read(bytes)) value = value * 256 + byte;
		return value;
	}

	/**
	 * Parse next CBOR value from stream.
	 *
	 * @returns Decoded value (primitives, Uint8Array, or Map)
	 * @throws Issue if stream is malformed
	 */
	#parseNext(depth = 0): CBOR.Value {
		if (depth > 8) throw new Issue("CBOR depth");

		const initial = this.#read(1)[0]!;
		const major = initial >> 5;
		const minor = initial & 0x1f;

		if (major === 7 && minor === 20) return false;
		if (major === 7 && minor === 21) return true;
		if (major === 7 && minor === 22) return null;

		let length: number;
		if (minor < 24) {
			length = minor;
		} else if (minor < 27) {
			// 24, 25 and 26 are followed by 1, 2 and 4 bytes
			length = this.#readUint(2 ** (minor - 24));
		} else {
			throw new Issue("CBOR length");
		}

		if (major === 0) return length;
		if (major === 1) return -1 - length;
		if (major === 2) return this.#read(length);
		if (major === 3) {
			try {
				return Codec.decode(this.#read(length));
			} catch {
				throw new Issue("CBOR text");
			}
		}
		if ((major === 4 || major === 5) && length > 128)
			throw new Issue("CBOR entries");
		if (major === 4)
			return Array.from({ length }, () => this.#parseNext(depth + 1));
		if (major === 5) {
			const map = new Map<CBOR.Key, CBOR.Value>();

			for (let i = 0; i < length; i++) {
				const k = this.#parseNext(depth + 1);

				if (typeof k !== "number" && typeof k !== "string") {
					throw new Issue("CBOR key");
				}

				if (map.has(k)) throw new Issue("CBOR duplicate key");
				map.set(k, this.#parseNext(depth + 1));
			}

			return map;
		}

		throw new Issue(`CBOR type ${major}`);
	}
}
