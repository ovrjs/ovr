import { CBOR } from "./cbor.js";
import { AuthIssue } from "./issue.js";

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
	/** Start byte offset of AAGUID */
	static readonly #aaguidStart = 37;

	/** Byte offset of credential ID length field */
	static readonly #credIdLengthOffset = 53;

	/** Credential ID length field size in bytes */
	static readonly #credIdLengthSize = 2;

	/** Start byte offset of credential ID data */
	static readonly #credIdStart = 55;

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
		if (data.length >= AuthData.#aaguidStart) {
			const flags = data[32]; // flags byte offset

			if (flags !== undefined) {
				let attestedCredentialData: AuthData.AttestedCredentialData | null =
					null;

				if ((flags & 0x40) !== 0) {
					// AT flag: attested credential data included
					// Need through credential length field + start of credId
					if (
						data.length >= AuthData.#credIdStart &&
						data.length >=
							AuthData.#credIdLengthOffset + AuthData.#credIdLengthSize
					) {
						const credIdLen = new DataView(
							data.buffer,
							data.byteOffset + AuthData.#credIdLengthOffset,
							AuthData.#credIdLengthSize,
						).getUint16(0, false);

						const credIdEnd = AuthData.#credIdStart + credIdLen;
						if (credIdLen !== 0 && credIdEnd <= data.length) {
							const coseBytes = data.subarray(credIdEnd);

							if (coseBytes.length > 0) {
								attestedCredentialData = {
									aaguid: data.subarray(AuthData.#aaguidStart, 53), // AAGUID end offset
									credentialId: data.subarray(AuthData.#credIdStart, credIdEnd),
									publicKey: new CBOR(coseBytes).decodeCOSEKey(),
								};

								return {
									rpIdHash: data.subarray(0, 32), // SHA-256 RP ID hash length
									flags,
									attestedCredentialData,
								};
							}
						}
					}
				} else {
					return {
						rpIdHash: data.subarray(0, 32), // SHA-256 RP ID hash length
						flags,
						attestedCredentialData,
					};
				}
			}
		}

		throw new AuthIssue("credential");
	}
}
