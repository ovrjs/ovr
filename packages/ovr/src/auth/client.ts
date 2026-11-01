/** Attach the passkey protocol to one form. Served as a normal browser module. */
export function listen(
	id: string,
	bootstrap: string,
	endpoint: string,
	method: "register" | "login",
) {
	const script = document.getElementById(id);
	const form = script?.closest("form");
	const status =
		form?.querySelector("[data-passkey-error]:not([data-passkey-fallback])") ??
		script?.previousElementSibling;
	if (!(form instanceof HTMLFormElement) || !(status instanceof HTMLElement))
		return;
	if (
		status !== script?.previousElementSibling &&
		script?.previousElementSibling instanceof HTMLElement
	)
		script.previousElementSibling.hidden = true;

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
	const reset = () => {
		clearTimeout(timer);
		timer = undefined;
		loading = submitting = finalizing = false;
		submitted = undefined;
		credential.value = ceremony.value = "";
		form.removeAttribute("aria-busy");
	};
	const clear = (e: Event) => {
		if (
			e.target instanceof HTMLElement &&
			"setCustomValidity" in e.target &&
			typeof e.target.setCustomValidity === "function"
		)
			e.target.setCustomValidity("");
	};
	form.addEventListener("input", clear);
	form.addEventListener("change", clear);

	form.addEventListener("submit", async (e) => {
		if (submitting) {
			if (finalizing) submitted = e;
			else e.preventDefault();
			return;
		}
		e.preventDefault();
		if (loading) return;
		if (retry > Date.now()) {
			status.textContent = `Too many requests. Try again in ${Math.ceil((retry - Date.now()) / 1000)} seconds.`;
			return;
		}
		loading = true;
		status.textContent = "";
		form.setAttribute("aria-busy", "true");
		try {
			if (!window.PublicKeyCredential || !navigator.credentials)
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
				throw new Error(
					`Too many requests. Try again in ${Math.ceil((retry - Date.now()) / 1000)} seconds.`,
				);
			}
			if (res.status === 422) {
				const result: { fields?: unknown } = await res.json();
				if (Array.isArray(result.fields))
					for (const name of result.fields) {
						if (typeof name !== "string") continue;
						const field = form.elements.namedItem(name);
						if (
							field instanceof HTMLElement &&
							"setCustomValidity" in field &&
							typeof field.setCustomValidity === "function"
						)
							field.setCustomValidity("Check this field.");
					}
				form.reportValidity();
				throw new Error("Check your registration details and try again.");
			}
			if (res.status === 410)
				throw new Error("This page has expired. Reload and try again.");
			if (!res.ok)
				throw new Error("Could not start the passkey request. Try again.");

			let result: Credential | null;
			if (method === "register") {
				const json: {
					ceremony: string;
					options: PublicKeyCredentialCreationOptionsJSON;
				} = await res.json();
				ceremony.value = json.ceremony;

				result = await navigator.credentials.create({
					publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(
						json.options,
					),
				});
			} else {
				const json: {
					ceremony: string;
					options: PublicKeyCredentialRequestOptionsJSON;
				} = await res.json();
				ceremony.value = json.ceremony;

				result = await navigator.credentials.get({
					publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(
						json.options,
					),
				});
			}
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
const scan = () => {
	for (const script of document.querySelectorAll<HTMLScriptElement>(
		"script[data-passkey]",
	)) {
		if (attached.has(script)) continue;
		const method = script.dataset.passkey;
		if (method === "register" || method === "login") {
			const reset = listen(
				script.id,
				script.dataset.bootstrap ?? "",
				script.dataset.endpoint ?? "",
				method,
			);
			if (reset) attached.set(script, reset);
		}
	}
};
if (typeof document !== "undefined") {
	window.addEventListener("pageshow", (e) => {
		if (e.persisted)
			for (const script of document.querySelectorAll<HTMLScriptElement>(
				"script[data-passkey]",
			))
				attached.get(script)?.();
	});
	scan();
	new MutationObserver(scan).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
}
