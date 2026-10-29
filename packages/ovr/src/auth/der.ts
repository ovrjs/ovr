import { Issue } from "./issue.js";

/** Strict DER decoding for WebAuthn ES256 signatures. */
export class DER {
	/** Convert a canonical DER ECDSA signature into Web Crypto's 64-byte format. */
	static unwrap(der: Uint8Array<ArrayBuffer>) {
		if (
			der.length < 8 ||
			der.length > 72 ||
			der[0] !== 0x30 ||
			der[1] !== der.length - 2
		)
			throw new Issue("DER signature");
		const raw = new Uint8Array(64);
		let offset = 2;
		for (let i = 0; i < 2; i++) {
			if (der[offset++] !== 2) throw new Issue("DER integer");
			const length = der[offset++];
			if (!length || length > 33 || offset + length > der.length)
				throw new Issue("DER integer length");
			let value = der.subarray(offset, offset + length);
			offset += length;
			if (value[0]! & 128) throw new Issue("DER negative integer");
			if (value[0] === 0 && value.length > 1) {
				if (!(value[1]! & 128)) throw new Issue("DER integer padding");
				value = value.subarray(1);
			}
			if (value.length > 32 || value.every((v) => v === 0))
				throw new Issue("DER integer");
			raw.set(value, (i + 1) * 32 - value.length);
		}
		if (offset !== der.length) throw new Issue("DER signature length");
		return raw;
	}
}
