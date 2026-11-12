import { source } from "./client-source.js";
import type { listen } from "./client.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
	validation = "";
	setCustomValidity(message: string) {
		this.validation = message;
	}
	name = "";
	type = "";
	value = "";
}
type Submission = {
	submitter: unknown;
	defaultPrevented: boolean;
	preventDefault: () => void;
	target?: Input;
};
class Form extends Element {
	querySelector() {
		return null;
	}
	fields = new Map<string, Input>();
	elements = { namedItem: (name: string) => this.fields.get(name) };
	handler?: (event: Submission) => Promise<void>;
	listeners = new Map<string, NonNullable<Form["handler"]>>();
	submissions: unknown[] = [];
	events: Submission[] = [];
	valid = true;
	cancel = false;
	reportValidity = vi.fn();
	append(input: Input) {
		this.fields.set(input.name, input);
	}
	addEventListener(name: string, handler: NonNullable<Form["handler"]>) {
		if (name === "submit") this.handler = handler;
		else this.listeners.set(name, handler);
	}
	async fire(submitter: unknown = null) {
		const event = {
			submitter,
			defaultPrevented: false,
			preventDefault: vi.fn(() => {
				event.defaultPrevented = true;
			}),
		};
		this.events.push(event);
		const pending = this.handler?.(event);
		// DOM dispatch calls other listeners synchronously, without awaiting async listeners.
		if (this.cancel) event.preventDefault();
		await pending;
	}
	requestSubmit(submitter: unknown) {
		this.submissions.push(submitter);
		if (this.valid) void this.fire(submitter);
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
	toJSON() {
		return {
			id: this.id,
			rawId: "AQ",
			type: this.type,
			authenticatorAttachment: "platform",
			clientExtensionResults: {},
			response:
				this.response instanceof Attestation
					? {
							clientDataJSON: "AQ",
							attestationObject: "Ag",
							authenticatorData: "Aw",
							publicKey: "BA",
							publicKeyAlgorithm: -7,
							transports: ["internal"],
						}
					: {
							clientDataJSON: "AQ",
							authenticatorData: "Ag",
							signature: "Aw",
							userHandle: "BA",
						},
		};
	}

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
	const creation = vi.fn((_options: unknown) => ({
		challenge: Uint8Array.of(42).buffer,
	}));
	const request = vi.fn((_options: unknown) => ({
		challenge: Uint8Array.of(43).buffer,
	}));

	vi.stubGlobal("HTMLFormElement", Form);
	vi.stubGlobal("HTMLElement", Element);
	vi.stubGlobal("HTMLInputElement", Input);
	vi.stubGlobal(
		"PublicKeyCredential",
		Object.assign(Credential, {
			parseCreationOptionsFromJSON: creation,
			parseRequestOptionsFromJSON: request,
		}),
	);
	vi.stubGlobal("AuthenticatorAttestationResponse", Attestation);
	vi.stubGlobal("AuthenticatorAssertionResponse", Assertion);
	const pages = new Map<string, (event: { persisted: boolean }) => void>();
	vi.stubGlobal("window", {
		PublicKeyCredential: Credential,
		addEventListener: (
			name: string,
			callback: (event: { persisted: boolean }) => void,
		) => pages.set(name, callback),
	});
	vi.stubGlobal("document", {
		getElementById: (id: string) => scripts.get(id),
		createElement: () => new Input(),
		querySelectorAll: () => [],
	});
	vi.stubGlobal(
		"MutationObserver",
		class {
			observe() {}
		},
	);
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
	// Execute the exact served JavaScript module, no scripts are on the page yet
	const init: typeof listen = new Function(
		`${source.replace("export function", "function")}\nreturn listen;`,
	)();
	return {
		first,
		second,
		status,
		fetcher,
		create,
		get,
		init,
		pages,
		creation,
		request,
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

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
		const button = { hasAttribute: () => false };
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
		expect(state.first.attributes.has("aria-busy")).toBe(true);
	});

	test("a button that submits elsewhere needs no passkey", async () => {
		const state = setup();
		const deny = { hasAttribute: (name: string) => name === "formaction" };
		state.init("first", "bootstrap", "/options", "login");
		await state.first.fire(deny);
		expect(state.first.events[0]?.preventDefault).not.toHaveBeenCalled();
		expect(state.fetcher).not.toHaveBeenCalled();
		expect(state.get).not.toHaveBeenCalled();
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

	test("confirms with a passkey the person has when the form asks, then finishes on the next press", async () => {
		const state = setup();
		const refused = () => new Response("Confirm your passkey", { status: 401 });
		state.fetcher.mockResolvedValueOnce(refused());
		const confirm = {
			bootstrap: "confirm-bootstrap",
			endpoint: "/options/confirm",
			action: "/auth/confirm",
		};
		state.init("first", "bootstrap", "/options/add", "register", confirm);
		await state.first.fire();

		// asked for the confirmation, prompted with it, and sent the answer
		const calls = state.fetcher.mock.calls;
		expect(calls.map(([url]) => url)).toEqual([
			"/options/add",
			"/options/confirm",
			"/auth/confirm",
		]);
		expect((calls[1]![1].body as FormData).get("bootstrap")).toBe(
			"confirm-bootstrap",
		);
		expect(state.get).toHaveBeenCalledOnce();
		expect(state.create).not.toHaveBeenCalled();
		expect((calls[2]![1].body as FormData).get("ceremony")).toBe("ceremony");
		expect(calls[2]![1].redirect).toBe("manual");
		// the answer here is not a 204, so it says it could not confirm
		expect(state.status[0]?.textContent).toContain("Could not confirm");
		expect(state.first.submissions).toHaveLength(0);

		// confirmed: the next press is the new passkey's
		state.fetcher
			.mockResolvedValueOnce(refused())
			.mockResolvedValueOnce(
				Response.json({ ceremony: "c", options: { challenge: "AQ" } }),
			)
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		await state.first.fire();
		expect(state.status[0]?.textContent).toContain("Press the button again");
		await state.first.fire();
		expect(state.create).toHaveBeenCalledOnce();
		expect(state.first.submissions).toHaveLength(1);

		// a form with nothing to confirm with says to sign in again
		const plain = setup();
		plain.fetcher.mockResolvedValueOnce(refused());
		plain.init("first", "bootstrap", "/options/add", "register");
		await plain.first.fire();
		expect(plain.status[0]?.textContent).toContain("Sign in again");
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

test("passes complete server policy to native parsing and preserves application fields", async () => {
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
	expect(state.creation).toHaveBeenCalledWith(
		expect.objectContaining({
			timeout: 12345,
			rp: { id: "example.com", name: "Example" },
			attestation: "none",
			authenticatorSelection: {
				residentKey: "required",
				userVerification: "required",
			},
			excludeCredentials: [
				{ type: "public-key", id: "Ag", transports: ["internal"] },
			],
		}),
	);
	expect(state.create).toHaveBeenCalledWith({
		publicKey: { challenge: Uint8Array.of(42).buffer },
	});
	expect(JSON.parse(state.first.fields.get("credential")!.value)).toMatchObject(
		{
			clientExtensionResults: {},
			authenticatorAttachment: "platform",
			response: { publicKeyAlgorithm: -7, transports: ["internal"] },
		},
	);
});

test("requires native JSON parsing and serialization for registration and login", async () => {
	const state = setup();
	const serialize = vi.spyOn(Credential.prototype, "toJSON");
	try {
		state.init("first", "bootstrap", "/options", "register");
		await state.first.fire();
		state.init("second", "bootstrap", "/options", "login");
		await state.second.fire();
		expect(state.creation).toHaveBeenCalledOnce();
		expect(state.request).toHaveBeenCalledOnce();
		expect(serialize).toHaveBeenCalledTimes(2);
		expect(state.create).toHaveBeenCalledWith({
			publicKey: { challenge: Uint8Array.of(42).buffer },
		});
		expect(state.get).toHaveBeenCalledWith({
			publicKey: { challenge: Uint8Array.of(43).buffer },
		});
		expect(
			JSON.parse(state.second.fields.get("credential")!.value).response,
		).toEqual({
			clientDataJSON: "AQ",
			authenticatorData: "Ag",
			signature: "Aw",
			userHandle: "BA",
		});
	} finally {
		serialize.mockRestore();
	}
});

test("a browser without the JSON helpers spends no challenge", async () => {
	const state = setup();
	const helpers = Credential as unknown as Record<string, unknown>;
	const parse = helpers.parseRequestOptionsFromJSON;
	delete helpers.parseRequestOptionsFromJSON;
	try {
		state.init("first", "bootstrap", "/options", "login");
		await state.first.fire();
		expect(state.fetcher).not.toHaveBeenCalled();
		expect(state.status[0]?.textContent).toBe(
			"Passkeys are unavailable in this browser.",
		);
	} finally {
		helpers.parseRequestOptionsFromJSON = parse;
	}
});

test("auto-initializes later streamed forms without attaching duplicate handlers", async () => {
	const state = setup();
	const scripts = [
		{
			id: "first",
			dataset: {
				passkey: "register",
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
		dataset: { passkey: "login", bootstrap: "second", endpoint: "/options" },
	});
	scan!();
	expect(state.first.handler).toBe(previous);
	await state.second.fire();
	expect(state.get).toHaveBeenCalledOnce();
	state.pages.get("pageshow")?.({ persisted: false });
	await state.second.fire();
	expect(state.get).toHaveBeenCalledOnce();
	state.pages.get("pageshow")?.({ persisted: true });
	await state.second.fire();
	expect(state.get).toHaveBeenCalledTimes(2);
});

test("keeps successful native submissions locked until back navigation resets the form", async () => {
	const state = setup();
	const reset = state.init("first", "bootstrap", "/options", "register");
	await state.first.fire();
	await state.first.fire();
	expect(state.fetcher).toHaveBeenCalledOnce();
	expect(state.first.submissions).toHaveLength(1);
	expect(state.first.events.at(-1)?.defaultPrevented).toBe(true);
	reset!();
	await state.first.fire();
	expect(state.fetcher).toHaveBeenCalledTimes(2);
});

test.each(["register", "login"] as const)(
	"recovers a %s form when native navigation never completes",
	async (method) => {
		const state = setup();
		state.init("first", "bootstrap", "/options", method);
		await state.first.fire();
		await vi.advanceTimersByTimeAsync(119999);
		await state.first.fire();
		expect(state.fetcher).toHaveBeenCalledOnce();
		expect(state.first.fields.get("ceremony")?.value).toBe("ceremony");
		await vi.advanceTimersByTimeAsync(1);
		expect(state.first.fields.get("ceremony")?.value).toBe("");
		expect(state.first.fields.get("credential")?.value).toBe("");
		expect(state.first.attributes.has("aria-busy")).toBe(false);
		expect(state.status[0]?.textContent).toContain(
			method === "register" ? "sign in" : "try again",
		);
		await state.first.fire();
		expect(state.fetcher).toHaveBeenCalledTimes(2);
	},
);

test("back navigation cancels the previous recovery timer before a fresh ceremony", async () => {
	const state = setup();
	const reset = state.init("first", "bootstrap", "/options", "login");
	await state.first.fire();
	await vi.advanceTimersByTimeAsync(60000);
	reset!();
	await state.first.fire();
	await vi.advanceTimersByTimeAsync(60000);
	expect(state.first.fields.get("ceremony")?.value).toBe("ceremony");
	expect(state.first.attributes.has("aria-busy")).toBe(true);
	await vi.advanceTimersByTimeAsync(60000);
	expect(state.first.fields.get("ceremony")?.value).toBe("");
});

test.each(["validation", "cancellation"])(
	"unlocks a final submission stopped by %s",
	async (reason) => {
		const state = setup();
		state.first.valid = reason !== "validation";
		state.first.cancel = reason === "cancellation";
		state.init("first", "bootstrap", "/options", "register");
		await state.first.fire();
		expect(vi.getTimerCount()).toBe(0);
		state.first.valid = true;
		state.first.cancel = false;
		await state.first.fire();
		expect(state.fetcher).toHaveBeenCalledTimes(2);
		expect(state.first.submissions).toHaveLength(2);
	},
);

test.each(["seconds", "date"])(
	"respects a Retry-After %s deadline without fetching early",
	async (format) => {
		const state = setup();
		const now = Date.now();
		const time = vi.spyOn(Date, "now").mockReturnValue(now);
		state.fetcher.mockResolvedValueOnce(
			new Response("Too many requests", {
				status: 429,
				headers: {
					"retry-after":
						format === "seconds" ? "60" : new Date(now + 60000).toUTCString(),
				},
			}),
		);
		try {
			state.init("first", "bootstrap", "/options", "register");
			await state.first.fire();
			expect(state.status[0]?.textContent).toContain("Too many requests");
			expect(state.status[0]?.textContent).not.toContain("Reload");
			await state.first.fire();
			expect(state.fetcher).toHaveBeenCalledOnce();
			expect(state.create).not.toHaveBeenCalled();
			time.mockReturnValue(now + 61000);
			await state.first.fire();
			expect(state.fetcher).toHaveBeenCalledTimes(2);
			expect(state.create).toHaveBeenCalledOnce();
		} finally {
			time.mockRestore();
		}
	},
);

test.each(["seconds", "date", "overflow"])(
	"caps an excessive Retry-After %s at an hour and permits a fresh request afterwards",
	async (format) => {
		const state = setup();
		const now = Date.now();
		state.fetcher.mockResolvedValueOnce(
			new Response("Too many requests", {
				status: 429,
				headers: {
					"retry-after":
						format === "date"
							? new Date(now + 86400000).toUTCString()
							: format === "overflow"
								? "9".repeat(400)
								: "86400",
				},
			}),
		);
		state.init("first", "bootstrap", "/options", "register");
		await state.first.fire();
		expect(state.status[0]?.textContent).toContain("3600 seconds");
		await vi.advanceTimersByTimeAsync(3599999);
		await state.first.fire();
		expect(state.fetcher).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(1);
		await state.first.fire();
		expect(state.fetcher).toHaveBeenCalledTimes(2);
		expect(state.create).toHaveBeenCalledOnce();
	},
);

test.each([undefined, "junk"])(
	"uses a bounded fallback for a missing or invalid Retry-After header: %s",
	async (header) => {
		const state = setup();
		state.fetcher.mockResolvedValueOnce(
			new Response("Too many requests", {
				status: 429,
				headers: header ? { "retry-after": header } : {},
			}),
		);
		state.init("first", "bootstrap", "/options", "register");
		await state.first.fire();
		expect(state.status[0]?.textContent).toContain("60 seconds");
		await vi.advanceTimersByTimeAsync(60000);
		await state.first.fire();
		expect(state.fetcher).toHaveBeenCalledTimes(2);
	},
);

test("marks invalid application fields with their own messages, without echoing others or requiring a reload", async () => {
	const state = setup();
	const email = new Input();
	email.name = "email";
	state.first.append(email);
	state.fetcher.mockResolvedValueOnce(
		Response.json(
			{ fields: { email: "Use your work email" }, message: "private details" },
			{ status: 422 },
		),
	);
	state.init("first", "bootstrap", "/options", "register");
	await state.first.fire();
	expect(email.validation).toBe("Use your work email");
	expect(state.first.reportValidity).toHaveBeenCalledOnce();
	expect(state.create).not.toHaveBeenCalled();
	expect(state.status[0]?.textContent).toContain(
		"Check your registration details",
	);
	expect(state.status[0]?.textContent).not.toMatch(/private|Reload/);
	await state.first.listeners.get("input")?.({
		submitter: null,
		preventDefault: () => {},
		defaultPrevented: false,
		target: email,
	});
	expect(email.validation).toBe("");
	await state.first.fire();
	expect(state.create).toHaveBeenCalledOnce();
});

test("expired form bootstraps ask for a reload without opening the authenticator", async () => {
	const state = setup();
	state.fetcher.mockResolvedValueOnce(
		new Response("Authentication failed.", { status: 410 }),
	);
	state.init("first", "bootstrap", "/options", "register");
	await state.first.fire();
	expect(state.status[0]?.textContent).toBe(
		"This page has expired. Reload and try again.",
	);
	expect(state.create).not.toHaveBeenCalled();
	expect(state.first.submissions).toHaveLength(0);
	expect(state.first.attributes.has("aria-busy")).toBe(false);
});
