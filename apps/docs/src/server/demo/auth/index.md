---
title: Authentication
description: Passkey forms, built-in handlers, and persistence callbacks for any database.
---

`Auth.passkey()` supplies registration, username-free login, logout, verification, and revocable sessions. Your application supplies typed callbacks using its own database or ORM. ovr adds no database driver, ORM integration, or runtime dependency. The current implementation supports discoverable **ES256 / P-256** passkeys with required user verification and `none` attestation.

```tsx
import { App, Auth, Field, Route } from "ovr";

const auth = Auth.passkey({
	secret, // At least 32 random bytes; keep it stable across restarts.
	origin: "https://example.com",
	name: "My app",
	page: "/auth",
	redirect: "/account",

	challenges: {
		set: (id, value) => saveChallenge(id, value),
		take: (id) => consumeChallenge(id),
	},
	sessions: {
		set: (token, value) => saveSession(token, value),
		get: (token) => findSession(token),
		delete: (token) => deleteSession(token),
	},
	credentials: {
		find: (id) => findPasskey(id),
		update: (next, previous) => updatePasskey(next, previous),
	},
	register: {
		fields: { email: Field.email({ label: "Email" }) },
		name: ({ email }) => email,
		create: async ({ email }, credential) => {
			await db.transaction(async (tx) => {
				await tx.insert(users).values({ id: credential.user, email });
				await tx.insert(passkeys).values(credential);
			});
		},
	},
});

const app = new App({ auth });

app.use(
	Route.get("/auth", (c) => {
		const { Register, Login } = auth.forms(c);

		return (
			<>
				<Register class="stack">
					<Register.Field name="email" />
					<Register.Error class="error" />
					<button>Create account</button>
				</Register>
				<Login>
					<Login.Error class="error" />
					<button>Sign in with a passkey</button>
				</Login>
			</>
		);
	}),
);
```

The persistence functions above are application code. The transaction shown uses the normal Drizzle API; ovr neither imports Drizzle nor chooses a database package for you. Registration fields determine the callback's data type and the available `Register.Field` names. `Register.Fields` renders all application fields. Omitting a form's children supplies fields, a button, and an accessible error status automatically. Plain HTML, field component customization, and normal form attributes remain available.

Call `auth.forms(c)` **inside the handler before returning JSX** so the secure browser binding cookie reaches the response. ovr prepares complete POST schemas when configuring the service; submitting to another instance does not require that instance to have rendered the form.

For a protected page:

```tsx
app.use(
	Route.get("/account", async (c) => {
		const session = await c.auth.session();
		if (!session) return c.redirect("/auth", 303);

		const { Logout } = auth.forms(c);
		return (
			<Logout>
				<button>Log out</button>
			</Logout>
		);
	}),
);
```

Load your user record using `session.id`. Email syntax validation does **not** verify ownership of an email address. Registration creates a new opaque UUID user handle; the account label returned by `register.name` is only for display in the passkey provider. This signup API does not attach passkeys to existing users. An account-management flow must separately authorize its current user before adding or removing credentials.

Persistence callbacks may be synchronous or asynchronous. All instances must share the same persistence and signing secret:

| Callback                             | Required behavior                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `challenges.set(id, value)`          | Store until `value.expiration`; evict expired records. May return `false` to refuse a write when capacity is exhausted.                           |
| `challenges.take(id)`                | **Atomically return and delete** the record; concurrent callers must have exactly one winner.                                                     |
| `sessions.set(token, value)`         | Persist the new session before ovr issues its cookie.                                                                                             |
| `sessions.get(token)`                | Return the session or nothing if expired/revoked. ovr also checks expiration.                                                                     |
| `sessions.delete(token)`             | Revoke the session; failures must throw.                                                                                                          |
| `credentials.find(id)`               | Return the stored passkey or nothing.                                                                                                             |
| `credentials.update(next, previous)` | Atomically compare the stored record against `previous`, save `next`, and return whether one record matched. Never recreate a deleted credential. |
| `register.create(data, credential)`  | Create the account and first passkey together in a transaction. Enforce a unique credential ID. Throw on failure.                                 |

`Auth.Credential` contains `id`, `user`, `publicKey` (base64url SPKI), `counter`, `eligible`, and `backedUp`. Counters are unsigned 32-bit numbers; eligibility and backup state are booleans. `Auth.Session` contains `{ id, token, expiration }` with expiration in milliseconds. `Auth.Challenge` describes the nonce, browser, operation, action pathname, origin, expiration, and optional registration user handle. These exported types can describe your persistence functions without an adapter class.

For PostgreSQL or SQLite with Drizzle, the two concurrency-sensitive callbacks can use ordinary queries:

```ts
import { and, eq } from "drizzle-orm";

// Your application dependency.

const challenges = {
	set: async (id: string, value: Auth.Challenge) => {
		await db.insert(ceremonies).values({ id, ...value });
	},
	take: async (id: string) => {
		const [value] = await db
			.delete(ceremonies)
			.where(eq(ceremonies.id, id))
			.returning();
		return value;
	},
};

const credentials = {
	find: async (id: string) => {
		const [value] = await db.select().from(passkeys).where(eq(passkeys.id, id));
		return value;
	},
	update: async (next: Auth.Credential, previous: Auth.Credential) => {
		const rows = await db
			.update(passkeys)
			.set({ counter: next.counter, backedUp: next.backedUp })
			.where(
				and(
					eq(passkeys.id, previous.id),
					eq(passkeys.user, previous.user),
					eq(passkeys.publicKey, previous.publicKey),
					eq(passkeys.counter, previous.counter),
					eq(passkeys.eligible, previous.eligible),
					eq(passkeys.backedUp, previous.backedUp),
				),
			)
			.returning({ id: passkeys.id });
		return rows.length === 1;
	},
};
```

Use database columns matching the exported types. Separate challenge reads and deletes are unsafe. A credential update must compare the owner, key, counter, and backup flags, even when a credential always reports a zero counter. Enforce user/credential/session relationships in the database. Schedule cleanup of expired state, and cap outstanding challenges in shared storage when serving public traffic; the SQLite demo shows a bounded atomic insert.

Default paths are `POST /auth/register`, `/auth/login`, `/auth/logout`, and `/_ovr/passkey/options/register` and `/login`, plus `GET /_ovr/passkey/client.js`. Override them together or individually with `paths: { register, login, logout, options, client }`; `options` is the base pathname for both options endpoints. `page` defaults to `/auth` and the success `redirect` defaults to `/`. Paths must be distinct literal local paths. Authentication failures return a generic status for options requests or redirect back to `page` with a generic form error. A failed logout returns HTTP 503 and leaves its session cookie intact. Supply `error(error, c)` for detailed server logging; the default uses `console.error`.

The browser runtime is a regular external JavaScript module. Policies allowing same-origin scripts work without inline JavaScript; nonce-based policies can use `auth.forms(c, { nonce })`. It handles streamed forms, cancellation, native validation, submitters, older browser option conversion, and newer native WebAuthn JSON parsers. JavaScript and HTTPS are required.

Session lifetime defaults to seven days (`duration` in milliseconds) without sliding refresh. `await c.auth.logout()` revokes the current session; `await c.auth.revoke(token)` revokes another selected session. Account-wide revocation can delete sessions by user ID in your own database. Each request reads shared session storage, so revocation applies across instances without a stale session cache. Authentication responses use `Cache-Control: no-store`.

The browser prompt defaults to 60 seconds (`timeout` in milliseconds); the server accepts the ceremony for that timeout **plus one minute** to allow response verification. Options are fetched on submit, and each ceremony is browser-, operation-, pathname-, and origin-bound and atomically consumed on the first verification attempt. Signed form bootstrap tokens expire after an hour. `credential`, `ceremony`, and `bootstrap` are reserved field names.

Built-in handlers limit each browser to 20 POST attempts per minute and each configured service instance to 1,000 per minute. These fixed-window limits bound process memory but are not fleet-wide or per-IP limits. Supply `allow(c)` with your shared limiter, or configure one at your trusted edge, for deployment-wide protection. Return `false` to send HTTP 429 before parsing the body or writing a challenge. Authentication form bodies are limited to 128 KiB. Trust only your deployment's canonical HTTPS request origin; ovr does not infer trust from arbitrary forwarded headers.

The runnable demo uses Node 24's built-in SQLite driver in application code, with no additional package. Enable it in development using `AUTH_SECRET`, `AUTH_ORIGIN` (default `https://localhost:5173`), and optional `AUTH_DATABASE` (default `.auth.sqlite`). Serve through HTTPS. Its database persists across restarts, is excluded from Git, and holds users, credentials, challenges, and sessions. Cleanup runs on startup and at most once per minute during writes.
