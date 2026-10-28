/** Self-contained browser runtime serialized into one passkey form. */
export function listen(
	id: string,
	bootstrap: string,
	endpoint: string,
	method: "register" | "login",
) {
	const script = document.getElementById(id);
	const form = script?.closest("form");
	const status = script?.previousElementSibling;
	if (!(form instanceof HTMLFormElement) || !(status instanceof HTMLElement))
		return;

	const hidden = (name: string) => {
		const field = form.elements.namedItem(name);
		if (field instanceof HTMLInputElement) return field;
		const input = document.createElement("input");
		input.type = "hidden";
		input.name = name;
		form.append(input);
		return input;
	};
	const credential = hidden("credential");
	const challenge = hidden("challenge");
	const decode = (value: string) =>
		Uint8Array.from(
			atob(
				value.replace(/-/g, "+").replace(/_/g, "/") +
					"=".repeat((4 - (value.length % 4)) % 4),
			),
			(c) => c.charCodeAt(0),
		).buffer;
	const encode = (value: ArrayBuffer) =>
		btoa(String.fromCharCode(...new Uint8Array(value)))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
	let loading = false;
	let submitting = false;

	form.addEventListener("submit", async (e) => {
		if (submitting) return;
		e.preventDefault();
		if (loading) return;
		loading = true;
		status.textContent = "";
		form.setAttribute("aria-busy", "true");
		try {
			if (!window.PublicKeyCredential || !navigator.credentials)
				throw new Error("Passkeys are unavailable in this browser.");
			const data = new FormData();
			data.set("bootstrap", bootstrap);
			const res = await fetch(endpoint, {
				method: "POST",
				body: data,
				credentials: "same-origin",
				cache: "no-store",
			});
			if (!res.ok)
				throw new Error(
					"Could not start the passkey request. Reload this page and try again.",
				);

			let result: Credential | null;
			if (method === "register") {
				const json: {
					challenge: string;
					options: PublicKeyCredentialCreationOptionsJSON;
				} = await res.json();
				challenge.value = json.challenge;
				const {
					challenge: nonce,
					user,
					excludeCredentials,
					rp,
					pubKeyCredParams,
				} = json.options;
				result = await navigator.credentials.create({
					publicKey: {
						rp,
						pubKeyCredParams,
						attestation: "none",
						timeout: 60000,
						authenticatorSelection: {
							residentKey: "required",
							requireResidentKey: true,
							userVerification: "required",
						},
						challenge: decode(nonce),
						user: { ...user, id: decode(user.id) },
						excludeCredentials: (excludeCredentials ?? []).map((v) => ({
							type: "public-key",
							id: decode(v.id),
						})),
					},
				});
			} else {
				const json: {
					challenge: string;
					options: PublicKeyCredentialRequestOptionsJSON;
				} = await res.json();
				challenge.value = json.challenge;
				const { challenge: nonce, allowCredentials, rpId } = json.options;
				result = await navigator.credentials.get({
					publicKey: {
						...(rpId ? { rpId } : {}),
						timeout: 60000,
						userVerification: "required",
						challenge: decode(nonce),
						allowCredentials: (allowCredentials ?? []).map((v) => ({
							type: "public-key",
							id: decode(v.id),
						})),
					},
				});
			}
			if (!(result instanceof PublicKeyCredential))
				throw new Error("No passkey was returned. Try again.");
			const response = result.response;
			// Explicit serialization also works in browsers without PublicKeyCredential.toJSON().
			credential.value = JSON.stringify({
				id: result.id,
				rawId: encode(result.rawId),
				type: result.type,
				response:
					response instanceof AuthenticatorAttestationResponse
						? {
								clientDataJSON: encode(response.clientDataJSON),
								attestationObject: encode(response.attestationObject),
							}
						: response instanceof AuthenticatorAssertionResponse
							? {
									clientDataJSON: encode(response.clientDataJSON),
									authenticatorData: encode(response.authenticatorData),
									signature: encode(response.signature),
									userHandle: response.userHandle
										? encode(response.userHandle)
										: null,
								}
							: null,
			});
			submitting = true;
			// Preserve native validation, submit events, and the original submitter.
			HTMLFormElement.prototype.requestSubmit.call(
				form,
				e.submitter ?? undefined,
			);
		} catch (error) {
			credential.value = "";
			challenge.value = "";
			status.textContent =
				error instanceof DOMException && error.name === "NotAllowedError"
					? "Passkey request canceled. Try again."
					: error instanceof Error
						? error.message
						: "Could not complete the passkey request. Try again.";
		} finally {
			loading = false;
			submitting = false;
			form.removeAttribute("aria-busy");
		}
	});
}
