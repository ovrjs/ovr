export type Options = { action: string } & (
	| {
			method: "create";
			passkey: PublicKeyCredentialCreationOptionsJSON;
			userId: string;
	  }
	| {
			method: "get";
			passkey: PublicKeyCredentialRequestOptionsJSON;
			userId?: undefined;
	  }
);

/**
 * Handler factory for passkey form submission.
 * Returns the actual submit handler bound to the provided options.
 *
 * Designed to be serialized and sent to the client as part of an IIFE so
 * nothing outside of the function scope should be used within.
 */
export const handler = (options: Options) => {
	return async (e: SubmitEvent) => {
		e.preventDefault();

		const decodeBase64Url = (s: string) => {
			const b64 = s.replace(/[-_]/g, (c) => (c === "-" ? "+" : "/"));
			const pad = b64.length % 4;
			return new Uint8Array(
				Array.from(atob(pad ? b64 + "=".repeat(4 - pad) : b64), (c) =>
					c.charCodeAt(0),
				),
			).buffer;
		};

		const attestations = new Set(["none", "indirect", "direct", "enterprise"]);
		const isAttestation = (v: string): v is AttestationConveyancePreference =>
			attestations.has(v);

		const verifications = new Set(["required", "preferred", "discouraged"]);
		const isUserVerification = (v: string): v is UserVerificationRequirement =>
			verifications.has(v);

		const transports = new Set([
			"ble",
			"hybrid",
			"internal",
			"nfc",
			"usb",
			"smart-card",
		]);
		const isTransports = (v: string[]): v is AuthenticatorTransport[] =>
			v.every((t) => transports.has(t));

		/** Decode credential descriptor from JSON */
		const decodeCredentialDescriptor = (cred: {
			type: string;
			id: string;
			transports?: string[];
		}): PublicKeyCredentialDescriptor => {
			const descriptor: PublicKeyCredentialDescriptor = {
				type: "public-key",
				id: decodeBase64Url(cred.id),
			};
			if (cred.transports && isTransports(cred.transports)) {
				descriptor.transports = cred.transports;
			}
			return descriptor;
		};

		/** Convert PublicKeyCredentialCreationOptionsJSON to PublicKeyCredentialCreationOptions */
		const decodeCreationOptions = (
			json: PublicKeyCredentialCreationOptionsJSON,
		): PublicKeyCredentialCreationOptions => {
			const result: PublicKeyCredentialCreationOptions = {
				challenge: decodeBase64Url(json.challenge),
				rp: json.rp,
				user: {
					id: decodeBase64Url(json.user.id),
					name: json.user.name,
					displayName: json.user.displayName,
				},
				pubKeyCredParams: json.pubKeyCredParams,
			};

			if (json.timeout !== undefined) result.timeout = json.timeout;

			if (json.excludeCredentials) {
				result.excludeCredentials = json.excludeCredentials.map(
					decodeCredentialDescriptor,
				);
			}

			if (json.authenticatorSelection) {
				result.authenticatorSelection = json.authenticatorSelection;
			}

			if (json.attestation !== undefined && isAttestation(json.attestation)) {
				result.attestation = json.attestation;
			}

			return result;
		};

		/** Convert PublicKeyCredentialRequestOptionsJSON to PublicKeyCredentialRequestOptions */
		const decodeRequestOptions = (
			json: PublicKeyCredentialRequestOptionsJSON,
		): PublicKeyCredentialRequestOptions => {
			const result: PublicKeyCredentialRequestOptions = {
				challenge: decodeBase64Url(json.challenge),
			};

			if (json.timeout !== undefined) result.timeout = json.timeout;
			if (json.rpId !== undefined) result.rpId = json.rpId;

			if (json.allowCredentials) {
				result.allowCredentials = json.allowCredentials.map(
					decodeCredentialDescriptor,
				);
			}

			if (
				json.userVerification !== undefined &&
				isUserVerification(json.userVerification)
			) {
				result.userVerification = json.userVerification;
			}

			return result;
		};

		const body = new FormData();

		body.append(
			"credential",
			JSON.stringify(
				options.method === "create"
					? await navigator.credentials.create({
							publicKey: decodeCreationOptions(options.passkey),
						})
					: await navigator.credentials.get({
							publicKey: decodeRequestOptions(options.passkey),
						}),
			),
		);

		if (options.userId) body.append("userId", options.userId);

		const r = await fetch(options.action, { method: "POST", body });

		if (r.ok) location.href = r.url;
	};
};
