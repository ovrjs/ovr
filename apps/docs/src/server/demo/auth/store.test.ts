import { Store } from "./store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Auth } from "ovr";
import { afterEach, describe, expect, test, vi } from "vitest";

const stores = new Set<Store>();
const folders: string[] = [];
const credential: Auth.Credential = {
	id: "credential-1",
	user: "user-1",
	publicKey: "test-key",
	counter: 0,
	eligible: true,
	backedUp: false,
};
const challenge = (): Auth.Challenge => ({
	challenge: "nonce",
	browser: "browser",
	method: "login",
	action: "/login",
	origin: "https://example.com",
	expiration: Date.now() + 60000,
});
const session = (): Auth.Session => ({
	id: credential.user,
	token: "session-1",
	expiration: Date.now() + 60000,
});

function open(path = ":memory:") {
	const store = new Store(path);
	stores.add(store);
	return store;
}

function file() {
	const folder = mkdtempSync(join(tmpdir(), "ovr-auth-"));
	folders.push(folder);
	return join(folder, "auth.sqlite");
}

afterEach(() => {
	for (const store of stores) store.close();
	stores.clear();
	for (const folder of folders)
		rmSync(folder, { recursive: true, force: true });
	folders.length = 0;
});

describe("SQLite authentication persistence", () => {
	test("shares atomic rate-limit budgets across connections and restarts", () => {
		const path = file();
		const first = open(path);
		const second = open(path);
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		try {
			const policy = { limit: 2, interval: 60000 };
			expect(first.consume("client", policy)).toBe(true);
			expect(second.consume("client", policy)).toBe(true);
			expect(open(path).consume("client", policy)).toBe(now + 30000);
			expect(second.consume("other", policy)).toBe(true);
			clock.mockReturnValue(now + 30000);
			expect(first.consume("client", policy)).toBe(true);
			expect(second.consume("client", policy)).toBe(now + 60000);
		} finally {
			clock.mockRestore();
		}
	});
	test("preserves users, passkeys, sessions, and pending challenges after reopening", () => {
		const path = file();
		const first = open(path);
		first.register(credential, "user@example.com");
		first.sessions.set("session-1", session());
		first.challenges.set("challenge-1", challenge());
		first.close();
		stores.delete(first);
		const second = open(path);
		expect(second.user(credential.user)).toEqual({
			id: credential.user,
			email: "user@example.com",
		});
		expect(second.credentials.find(credential.id)).toEqual(credential);
		expect(second.sessions.get("session-1")).toMatchObject({
			id: credential.user,
			token: "session-1",
		});
		expect(second.challenges.take("challenge-1")).toMatchObject({
			challenge: "nonce",
		});
	});

	test("consumes a challenge once across independent database connections", () => {
		const path = file();
		const first = open(path);
		const second = open(path);
		first.challenges.set("challenge-1", challenge());
		expect(second.challenges.take("challenge-1")).toBeDefined();
		expect(first.challenges.take("challenge-1")).toBeUndefined();
	});

	test("revokes sessions across connections and refuses expired records", () => {
		const path = file();
		const first = open(path);
		const second = open(path);
		first.register(credential, "user@example.com");
		first.sessions.set("session-1", session());
		expect(second.sessions.get("session-1")).toBeDefined();
		second.sessions.delete("session-1");
		expect(first.sessions.get("session-1")).toBeUndefined();
		first.sessions.set("session-1", {
			...session(),
			expiration: Date.now() - 1,
		});
		expect(second.sessions.get("session-1")).toBeUndefined();
		first.challenges.set("expired", {
			...challenge(),
			expiration: Date.now() - 1,
		});
		expect(second.challenges.take("expired")).toBeUndefined();
	});

	test("atomically updates a snapshot and rejects stale or deleted credentials", () => {
		const path = file();
		const first = open(path);
		const second = open(path);
		first.register(credential, "user@example.com");
		const next = { ...credential, counter: 1, backedUp: true };
		expect(second.credentials.update(next, credential)).toBe(true);
		expect(
			first.credentials.update({ ...credential, counter: 2 }, credential),
		).toBe(false);
		expect(first.credentials.find(credential.id)).toEqual(next);
		expect(
			first.credentials.update({ ...next, publicKey: "replacement" }, next),
		).toBe(false);
		expect(
			first.credentials.update(
				{ ...next, id: "deleted" },
				{ ...next, id: "deleted" },
			),
		).toBe(false);
	});

	test("rolls back a new account when its credential ID already exists", () => {
		const store = open();
		store.register(credential, "first@example.com");
		expect(() =>
			store.register(
				{ ...credential, user: "second-user" },
				"second@example.com",
			),
		).toThrow();
		expect(store.user("second-user")).toBeUndefined();
		expect(store.user(credential.user)?.email).toBe("first@example.com");
		expect(store.list(credential.user)).toEqual([credential]);
	});

	test("binds SQL parameters and does not treat account data as executable SQL", () => {
		const store = open();
		const email = "'); DROP TABLE users; --";
		store.register(credential, email);
		expect(store.user(credential.user)?.email).toBe(email);
		expect(() => store.sessions.set("wrong-token", session())).toThrow(
			"mismatch",
		);
		store.sessions.set("session-1", session());
		store.challenges.set("challenge-1", challenge());
		store.prune(Date.now() + 120000);
		expect(store.sessions.get("session-1")).toBeUndefined();
		expect(store.challenges.take("challenge-1")).toBeUndefined();
		expect(store.credentials.find(credential.id)).toEqual(credential);
	});
});

test("bounds outstanding challenges across connections and reclaims consumed capacity", () => {
	const path = file();
	const first = open(path);
	const second = open(path);
	for (let i = 0; i < 10; i++)
		expect(first.challenges.set(`challenge-${i}`, challenge())).toBe(true);
	expect(second.challenges.set("overflow", challenge())).toBe(false);
	second.challenges.take("challenge-0");
	expect(first.challenges.set("replacement", challenge())).toBe(true);
});

test("does not attach a second credential by reusing an existing signup user ID", () => {
	const store = open();
	store.register(credential, "original@example.com");
	expect(() =>
		store.register(
			{ ...credential, id: "second-credential" },
			"replacement@example.com",
		),
	).toThrow();
	expect(store.user(credential.user)?.email).toBe("original@example.com");
	expect(store.list(credential.user)).toEqual([credential]);
});
