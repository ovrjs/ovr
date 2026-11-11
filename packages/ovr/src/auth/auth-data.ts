import { CBOR } from "./cbor.js";
import { Issue } from "./issue.js";

export namespace AuthData {
	/** Parsed authenticator data and credential state. */
	export interface Data {
		rpIdHash: Uint8Array;
		flags: number;
		counter: number;
		attestedCredentialData: AttestedCredentialData | null;
	}
	/** Attested ES256 credential. */
	export interface AttestedCredentialData {
		aaguid: Uint8Array;
		credentialId: Uint8Array;
		publicKey: Map<number, number | Uint8Array>;
	}
}

/** Bounded parser for WebAuthn authenticator data. */
export class AuthData {
	/** Parse the fixed header, optional attested credential, and optional extensions. */
	static parse(data: Uint8Array) {
		if (data.length < 37) throw new Issue("credential");
		const view = new DataView(data.buffer, data.byteOffset, data.length);
		const flags = data[32]!;
		let end = 37;
		let attestedCredentialData: AuthData.AttestedCredentialData | null = null;
		if (flags & 64) {
			if (data.length < 55) throw new Issue("credential");
			const length = view.getUint16(53);
			end = 55 + length;
			if (!length || length > 1023 || end >= data.length)
				throw new Issue("credential");
			const cbor = new CBOR(data.subarray(end));
			attestedCredentialData = {
				aaguid: data.subarray(37, 53),
				credentialId: data.subarray(55, end),
				publicKey: cbor.decodeCOSEKey(),
			};
			end += cbor.offset;
		}
		if (flags & 128) {
			const cbor = new CBOR(data.subarray(end));
			cbor.decodeExtensions();
			end += cbor.offset;
		}
		if (end !== data.length) throw new Issue("authenticator data length");
		return {
			rpIdHash: data.subarray(0, 32),
			flags,
			counter: view.getUint32(33),
			attestedCredentialData,
		};
	}
}
