/** DER (Distinguished Encoding Rules) format utilities for signatures */
export class DER {
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

		if (view.getUint8(0) !== 0x30) return der; // DER SEQUENCE tag

		let offset = 2;

		if (view.getUint8(1) & 0x80) {
			// long-form length flag
			offset += view.getUint8(1) & 0x7f; // number of following length bytes
		}

		const rLen = view.getUint8(offset + 1);
		let r = der.subarray(offset + 2, offset + 2 + rLen);
		offset += 2 + rLen;

		const sLen = view.getUint8(offset + 1);
		let s = der.subarray(offset + 2, offset + 2 + sLen);

		while (r.length > DER.#coordinateLength && r[0] === 0) r = r.subarray(1);
		while (s.length > DER.#coordinateLength && s[0] === 0) s = s.subarray(1);

		const raw = new Uint8Array(DER.#signatureLength);
		raw.set(r, DER.#signatureLength / 2 - r.length);
		raw.set(s, DER.#signatureLength - s.length);
		return raw;
	}
}
