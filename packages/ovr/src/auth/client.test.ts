import { source } from "./client-source.js";
import type { listen } from "./client.js";
import { afterEach, describe, expect, test, vi } from "vitest";

class Element {
	textContent = "";
	attributes = new Map<string, string>();
	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}
	removeAttribute(name: string) {
		this.attributes.delete(name);
	}
}
class Input extends Element {
	name = "";
	type = "";
	value = "";
}
class Form extends Element {
	querySelector() {
		return null;
	}
	fields = new Map<string, Input>();
	elements = { namedItem: (name: string) => this.fields.get(name) };
	handler?: (event: {
		submitter: unknown;
		preventDefault: () => void;
	}) => Promise<void>;
	submissions: unknown[] = [];
	events: { submitter: unknown; preventDefault: () => void }[] = [];
	append(input: Input) {
		this.fields.set(input.name, input);
	}
	addEventListener(_name: string, handler: NonNullable<Form["handler"]>) {
		this.handler = handler;
	}
	async fire(submitter: unknown = null) {
		const event = { submitter, preventDefault: vi.fn() };
		this.events.push(event);
		await this.handler?.(event);
	}
	requestSubmit(submitter: unknown) {
		this.submissions.push(submitter);
		void this.fire(submitter);
	}
}
class Attestation {
	clientDataJSON = Uint8Array.of(1).buffer;
	attestationObject = Uint8Array.of(2).buffer;
}
class Assertion {
	clientDataJSON = Uint8Array.of(1).buffer;
	authenticatorData = Uint8Array.of(2).buffer;
	signature = Uint8Array.of(3).buffer;
	userHandle = Uint8Array.of(4).buffer;
}
class Credential {
	id = "AQ";
	rawId = Uint8Array.of(1).buffer;
	type = "public-key";
	readonly response: Attestation | Assertion;
	constructor(response: Attestation | Assertion) {
		this.response = response;
	}
}

function setup() {
	const first = new Form();
	const second = new Form();
	const status = [new Element(), new Element()];
	const scripts = new Map([
		["first", { closest: () => first, previousElementSibling: status[0] }],
		["second", { closest: () => second, previousElementSibling: status[1] }],
	]);
	const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
		Response.json({
			ceremony: "ceremony",
			options: {
				challenge: "AQ",
				rp: { id: "example.com", name: "Example" },
				user: { id: "AQ", name: "user", displayName: "User" },
				pubKeyCredParams: [{ type: "public-key", alg: -7 }],
			},
		}),
	);
	const create = vi.fn(async () => new Credential(new Attestation()));
	const get = vi.fn(async () => new Credential(new Assertion()));
	vi.stubGlobal("HTMLFormElement", Form);
	vi.stubGlobal("HTMLElement", Element);
	vi.stubGlobal("HTMLInputElement", Input);
	vi.stubGlobal("PublicKeyCredential", Credential);
	vi.stubGlobal("AuthenticatorAttestationResponse", Attestation);
	vi.stubGlobal("AuthenticatorAssertionResponse", Assertion);
	vi.stubGlobal("window", { PublicKeyCredential: Credential });
	vi.stubGlobal("document", {
		getElementById: (id: string) => scripts.get(id),
		createElement: () => new Input(),
	});
	vi.stubGlobal("navigator", { credentials: { create, get } });
	vi.stubGlobal("fetch", fetcher);
	const NativeFormData = globalThis.FormData;
	vi.stubGlobal(
		"FormData",
		class extends NativeFormData {
			constructor(form?: Form) {
				super();
				for (const [name, field] of form?.fields ?? [])
					this.set(name, field.value);
			}
		},
	);
	// Execute the exact served JavaScript module, without browser auto-initialization in this unit harness.
	const init: typeof listen = new Function(
		`${source.slice(0, source.indexOf("// Modules execute")).replace("export function", "function")}\nreturn listen;`,
	)();
	return { first, second, status, fetcher, create, get, init };
}

afterEach(() => vi.unstubAllGlobals());

describe("passkey browser runtime", () => {
	test("attaches only to the owning form, even when multiple forms share an action", async () => {
		const state = setup();
		state.init("first", "first-bootstrap", "/options", "register");
		expect(state.second.handler).toBeUndefined();
		state.init("second", "second-bootstrap", "/options", "register");
		await state.first.fire();
		await state.second.fire();
		expect(state.fetcher.mock.calls).toHaveLength(2);
		const calls = state.fetcher.mock.calls;
		expect(
			calls.map(
				(v) => v[1].body instanceof FormData && v[1].body.get("bootstrap"),
			),
		).toEqual(["first-bootstrap", "second-bootstrap"]);
		expect(state.first.fields.get("ceremony")?.value).toBe("ceremony");
		expect(state.second.fields.get("ceremony")?.value).toBe("ceremony");
	});

	test("preserves the original submitter, native validation, and the final submit event", async () => {
		const state = setup();
		const button = {};
		state.init("first", "bootstrap", "/options", "login");
		await state.first.fire(button);
		expect(state.first.submissions).toEqual([button]);
		expect(state.first.events).toHaveLength(2);
		expect(state.first.events[0]?.preventDefault).toHaveBeenCalled();
		expect(state.first.events[1]?.preventDefault).not.toHaveBeenCalled();
		expect(
			JSON.parse(state.first.fields.get("credential")!.value).response
				.userHandle,
		).toBe("BA");
		expect(state.get).toHaveBeenCalledOnce();
		expect(state.first.attributes.has("aria-busy")).toBe(false);
	});

	test("announces cancellation, clears stale fields, and permits a fresh retry", async () => {
		const state = setup();
		state.create.mockRejectedValueOnce(
			new DOMException("canceled", "NotAllowedError"),
		);
		state.init("first", "bootstrap", "/options", "register");
		await state.first.fire();
		expect(state.status[0]?.textContent).toContain("canceled");
		expect(state.first.fields.get("credential")?.value).toBe("");
		expect(state.first.fields.get("ceremony")?.value).toBe("");
		expect(state.first.submissions).toHaveLength(0);
		await state.first.fire();
		expect(state.first.submissions).toHaveLength(1);
		expect(state.fetcher).toHaveBeenCalledTimes(2);
	});

	test("blocks duplicate submissions while the browser prompt is pending", async () => {
		const state = setup();
		let finish: ((value: Credential) => void) | undefined;
		state.create.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		state.init("first", "bootstrap", "/options", "register");
		const pending = state.first.fire();
		await vi.waitFor(() => expect(finish).toBeDefined());
		await state.first.fire();
		expect(state.fetcher).toHaveBeenCalledOnce();
		finish!(new Credential(new Attestation()));
		await pending;
		expect(state.first.submissions).toHaveLength(1);
	});
});

test("browser fallbacks preserve server policy and application fields", async () => {
	const state = setup();
	const email = new Input();
	email.name = "email";
	email.value = "user@example.com";
	state.first.append(email);
	state.fetcher.mockResolvedValueOnce(
		Response.json({
			ceremony: "id",
			options: {
				challenge: "AQ",
				timeout: 12345,
				rp: { id: "example.com", name: "Example" },
				user: { id: "AQ", name: "human", displayName: "Human" },
				pubKeyCredParams: [{ type: "public-key", alg: -7 }],
				attestation: "none",
				authenticatorSelection: {
					residentKey: "required",
					userVerification: "required",
				},
				excludeCredentials: [
					{ type: "public-key", id: "Ag", transports: ["internal"] },
				],
			},
		}),
	);
	state.init("first", "bootstrap", "/options", "register");
	await state.first.fire();
	expect(state.fetcher.mock.calls[0]?.[1].body).toBeInstanceOf(FormData);
	const body = state.fetcher.mock.calls[0]![1].body;
	if (!(body instanceof FormData)) throw new Error("Expected form data");
	expect(body.get("email")).toBe("user@example.com");
	expect(body.has("credential")).toBe(false);
	expect(body.has("ceremony")).toBe(false);
	expect(state.create).toHaveBeenCalledWith({
		publicKey: expect.objectContaining({
			timeout: 12345,
			challenge: Uint8Array.of(1).buffer,
			excludeCredentials: [
				{
					type: "public-key",
					id: Uint8Array.of(2).buffer,
					transports: ["internal"],
				},
			],
		}),
	});
});

test("uses native JSON option parsers when the browser supplies them", async () => {
	const state = setup();
	const creation = vi.fn(() => ({ challenge: Uint8Array.of(42).buffer }));
	const request = vi.fn(() => ({ challenge: Uint8Array.of(43).buffer }));
	vi.stubGlobal(
		"PublicKeyCredential",
		Object.assign(Credential, {
			parseCreationOptionsFromJSON: creation,
			parseRequestOptionsFromJSON: request,
		}),
	);
	try {
		state.init("first", "bootstrap", "/options", "register");
		await state.first.fire();
		state.init("second", "bootstrap", "/options", "login");
		await state.second.fire();
		expect(creation).toHaveBeenCalledOnce();
		expect(request).toHaveBeenCalledOnce();
		expect(state.create).toHaveBeenCalledWith({
			publicKey: { challenge: Uint8Array.of(42).buffer },
		});
		expect(state.get).toHaveBeenCalledWith({
			publicKey: { challenge: Uint8Array.of(43).buffer },
		});
	} finally {
		Reflect.deleteProperty(Credential, "parseCreationOptionsFromJSON");
		Reflect.deleteProperty(Credential, "parseRequestOptionsFromJSON");
	}
});

test("auto-initializes later streamed forms without attaching duplicate handlers", async () => {
	const state = setup();
	const scripts = [
		{
			id: "first",
			dataset: {
				ovrPasskey: "register",
				bootstrap: "first",
				endpoint: "/options",
			},
		},
	];
	vi.stubGlobal("document", { ...document, querySelectorAll: () => scripts });
	let scan: (() => void) | undefined;
	const observe = vi.fn();
	vi.stubGlobal(
		"MutationObserver",
		class {
			constructor(callback: () => void) {
				scan = callback;
			}
			observe = observe;
		},
	);
	new Function(source.replace("export function", "function"))();
	expect(observe).toHaveBeenCalledOnce();
	expect(state.first.handler).toBeDefined();
	expect(state.second.handler).toBeUndefined();
	const previous = state.first.handler;
	scripts.push({
		id: "second",
		dataset: { ovrPasskey: "login", bootstrap: "second", endpoint: "/options" },
	});
	scan!();
	expect(state.first.handler).toBe(previous);
	await state.second.fire();
	expect(state.get).toHaveBeenCalledOnce();
});
