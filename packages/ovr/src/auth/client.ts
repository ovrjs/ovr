/** Attach the passkey protocol to one form. Served as a normal browser module. */
export function listen(
	id: string,
	bootstrap: string,
	endpoint: string,
	method: "register" | "login",
	/** Confirms the person with a passkey they have, when the form asks */
	confirm?: { bootstrap: string; endpoint: string; action: string },
) {
	const script = document.getElementById(id);
	const form = script?.closest("form");
	// the accessible error component the form renders before the script
	const fallback = script?.previousElementSibling;
	const status =
		form?.querySelector("[data-passkey-error]:not([data-passkey-fallback])") ??
		fallback;
	if (!(form instanceof HTMLFormElement) || !(status instanceof HTMLElement))
		return;
	if (status !== fallback && fallback instanceof HTMLElement)
		fallback.hidden = true;

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
	const ceremony = hidden("ceremony");
	let loading = false;
	let submitting = false;
	let finalizing = false;
	let submitted: SubmitEvent | undefined;
	let retry = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limited = () =>
		`Too many requests. Try again in ${Math.ceil((retry - Date.now()) / 1000)} seconds.`;
	const reset = () => {
		clearTimeout(timer);
		timer = undefined;
		loading = submitting = finalizing = false;
		submitted = undefined;
		credential.value = ceremony.value = "";
		form.removeAttribute("aria-busy");
	};
	/** Mark a form field invalid, or valid again with an empty message */
	const validity = (field: unknown, message: string) => {
		if (
			field instanceof HTMLElement &&
			"setCustomValidity" in field &&
			typeof field.setCustomValidity === "function"
		)
			field.setCustomValidity(message);
	};
	const clear = (e: Event) => validity(e.target, "");
	form.addEventListener("input", clear);
	form.addEventListener("change", clear);

	form.addEventListener("submit", async (e) => {
		// a button that submits elsewhere, such as Deny, needs no passkey
		if (e.submitter?.hasAttribute("formaction")) return;
		if (submitting) {
			if (finalizing) submitted = e;
			else e.preventDefault();
			return;
		}
		e.preventDefault();
		if (loading) return;
		if (retry > Date.now()) {
			status.textContent = limited();
			return;
		}
		loading = true;
		status.textContent = "";
		form.setAttribute("aria-busy", "true");
		try {
			// checked before asking for options, which would spend a challenge
			if (
				!window.PublicKeyCredential?.parseCreationOptionsFromJSON ||
				!PublicKeyCredential.parseRequestOptionsFromJSON ||
				!navigator.credentials
			)
				throw new Error("Passkeys are unavailable in this browser.");
			const data = new FormData(form);
			data.delete("credential");
			data.delete("ceremony");
			data.set("bootstrap", bootstrap);
			const res = await fetch(endpoint, {
				method: "POST",
				body: data,
				credentials: "same-origin",
				cache: "no-store",
			});
			if (res.status === 429) {
				const now = Date.now();
				const header = res.headers.get("retry-after") ?? "60";
				const deadline = /^\d+$/.test(header)
					? now + Number(header) * 1000
					: Date.parse(header);
				retry = Number.isNaN(deadline)
					? now + 60000
					: Math.min(now + 3600000, Math.max(now + 1000, deadline));
				throw new Error(limited());
			}
			if (res.status === 422) {
				const result: { fields?: unknown } = await res.json();
				if (result.fields && typeof result.fields === "object")
					for (const [name, message] of Object.entries(result.fields))
						if (typeof message === "string")
							validity(form.elements.namedItem(name), message);
				form.reportValidity();
				throw new Error("Check your registration details and try again.");
			}
			if (res.status === 410)
				throw new Error("This page has expired. Reload and try again.");
			// adding a passkey asks for a recent sign-in, or for a passkey the
			// person already has
			if (res.status === 401) {
				if (!confirm) throw new Error("Sign in again, then try once more.");
				const send = (url: string, body: FormData) =>
					fetch(url, {
						method: "POST",
						body,
						credentials: "same-origin",
						cache: "no-store",
						redirect: "manual",
					});
				const ask = new FormData();
				ask.set("bootstrap", confirm.bootstrap);
				const asked = await send(confirm.endpoint, ask);
				if (asked.status === 410)
					throw new Error("This page has expired. Reload and try again.");
				if (!asked.ok) throw new Error("Sign in again, then try once more.");
				const proof: { ceremony: string; options: unknown } =
					await asked.json();
				const mine = await navigator.credentials.get({
					publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(
						proof.options as PublicKeyCredentialRequestOptionsJSON,
					),
				});
				if (!(mine instanceof PublicKeyCredential))
					throw new Error("No passkey was returned. Try again.");
				const answer = new FormData();
				answer.set("credential", JSON.stringify(mine));
				answer.set("ceremony", proof.ceremony);
				if ((await send(confirm.action, answer)).status !== 204)
					throw new Error("Could not confirm your passkey. Try again.");
				// a browser asks for a new press before its next passkey prompt
				throw new Error("Confirmed. Press the button again to finish.");
			}
			if (!res.ok)
				throw new Error("Could not start the passkey request. Try again.");

			// creation options for a registration, request options for a login
			const json: { ceremony: string; options: unknown } = await res.json();
			ceremony.value = json.ceremony;

			const result = await (method === "register"
				? navigator.credentials.create({
						publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(
							json.options as PublicKeyCredentialCreationOptionsJSON,
						),
					})
				: navigator.credentials.get({
						publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(
							json.options as PublicKeyCredentialRequestOptionsJSON,
						),
					}));
			if (!(result instanceof PublicKeyCredential))
				throw new Error("No passkey was returned. Try again.");
			credential.value = JSON.stringify(result);
			submitting = true;
			finalizing = true;
			submitted = undefined;
			// Preserve native validation, submit events, and the original submitter.
			HTMLFormElement.prototype.requestSubmit.call(
				form,
				e.submitter ?? undefined,
			);
			finalizing = false;
			// requestSubmit synchronously re-enters this listener; TypeScript cannot see that assignment.
			// Validation may prevent the final event; another listener may cancel it.
			submitting = Boolean(
				submitted && !(submitted as SubmitEvent).defaultPrevented,
			);
			if (submitting)
				timer = setTimeout(() => {
					reset();
					status.textContent =
						method === "register"
							? "If registration already completed, sign in; otherwise try again."
							: "If sign-in did not finish, try again.";
				}, 120000);
		} catch (error) {
			reset();
			status.textContent =
				error instanceof DOMException && error.name === "NotAllowedError"
					? "Passkey request canceled. Try again."
					: error instanceof Error
						? error.message
						: "Could not complete the passkey request. Try again.";
		} finally {
			loading = false;
			finalizing = false;
			if (!submitting) form.removeAttribute("aria-busy");
		}
	});
	return reset;
}

// Modules execute once per document. Observe streamed HTML and subsequent fragment navigation too.
const attached = new WeakMap<HTMLScriptElement, () => void>();
const scripts = () =>
	document.querySelectorAll<HTMLScriptElement>("script[data-passkey]");
const scan = () => {
	for (const script of scripts()) {
		if (attached.has(script)) continue;
		const method = script.dataset.passkey;
		if (method === "register" || method === "login") {
			const reset = listen(
				script.id,
				script.dataset.bootstrap ?? "",
				script.dataset.endpoint ?? "",
				method,
				script.dataset.confirm
					? {
							bootstrap: script.dataset.confirm,
							endpoint: script.dataset.confirmEndpoint ?? "",
							action: script.dataset.confirmAction ?? "",
						}
					: undefined,
			);
			if (reset) attached.set(script, reset);
		}
	}
};
if (typeof document !== "undefined") {
	window.addEventListener("pageshow", (e) => {
		if (e.persisted) for (const script of scripts()) attached.get(script)?.();
	});
	scan();
	new MutationObserver(scan).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
}
