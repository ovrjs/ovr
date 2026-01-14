import { CBOR } from "./cbor.js";

export namespace AuthData {
	export type Data = {
		rpIdHash: Uint8Array<ArrayBufferLike>;
		flags: number;
		attestedCredentialData: AuthData.AttestedCredentialData | null;
	};

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
export class AuthData {
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
	 * Note: Signature counter is extracted but not validated. The stateless design assumes
	 * platform-bound credentials and does not support discoverable keys (which could be cloned).
	 *
	 * @param data - Raw authenticator data bytes
	 * @returns Parsed authenticator data with flags and optional credential data
	 */
	static parse(data: Uint8Array) {
		// Need rpIdHash (32) + flags (1) + signCount (4) at least
		// Offsets assume at least 37 bytes to reach AAGUID
		if (data.length < AuthData.#aaguidStart) {
			throw new TypeError("Invalid credential");
		}

		const flags = data[AuthData.#flagsOffset];
		if (flags === undefined) {
			throw new TypeError("Invalid credential");
		}

		let attestedCredentialData: AuthData.AttestedCredentialData | null = null;

		if (flags & AuthData.#attestedCredentialFlag) {
			// Need through credential length field + start of credId
			if (data.length < AuthData.#credIdStart) {
				throw new TypeError("Invalid credential");
			}

			if (
				data.length <
				AuthData.#credIdLengthOffset + AuthData.#credIdLengthSize
			) {
				throw new TypeError("Invalid credential");
			}

			const credIdLen = new DataView(
				data.buffer,
				data.byteOffset + AuthData.#credIdLengthOffset,
				AuthData.#credIdLengthSize,
			).getUint16(0, false);

			const credIdEnd = AuthData.#credIdStart + credIdLen;
			if (credIdLen === 0 || credIdEnd > data.length) {
				throw new TypeError("Invalid credential");
			}

			const coseBytes = data.subarray(credIdEnd);
			if (coseBytes.length === 0) {
				throw new TypeError("Invalid credential");
			}

			attestedCredentialData = {
				aaguid: data.subarray(AuthData.#aaguidStart, AuthData.#aaguidEnd),
				credentialId: data.subarray(AuthData.#credIdStart, credIdEnd),
				publicKey: new CBOR(coseBytes).decodeCOSEKey(),
			};
		}

		return {
			rpIdHash: data.subarray(0, AuthData.#rpIdHashLength),
			flags,
			attestedCredentialData,
		};
	}
}
