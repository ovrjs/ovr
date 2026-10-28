---
title: Authentication
description: Build passkey registration and login flows with Context.auth.
---

Configure `App` with an HTTPS origin, a random signing secret of at least 32 bytes, and shared storage adapters. The passkey implementation uses Web Crypto and has no runtime dependencies. It currently supports **ES256 / P-256**, discoverable credentials, and `none` attestation.

```ts
import { App, type Auth } from "ovr";

const app = new App({
	auth: {
		secret,
		origin: "https://example.com",
		name: "My app",
		challenges,
		sessions,
	},
});
```

`challenges` implements `Auth.Challenges`:

- `set(id, challenge)` stores a ceremony until `challenge.expiration`.
- `take(id)` **atomically returns and deletes** that ceremony. Concurrent requests must have exactly one winner. Use an atomic database operation, such as Redis `GETDEL` or SQL `DELETE ... RETURNING`; separate reads and deletes are unsafe across processes.

`sessions` implements `Auth.Sessions`:

- `set(token, session)` stores a new session until `session.expiration`.
- `get(token)` returns a live session, or nothing for an expired or revoked session.
- `delete(token)` revokes it.

All adapter methods may return values or promises. Use shared storage across application instances and evict expired records. Session lifetime defaults to seven days, configured with `duration` in milliseconds. Reading a session does not extend its lifetime.

Create form components **in the route handler before returning JSX**, so the browser binding cookie is included in the response:

```tsx
import { Field, Route } from "ovr";

export const page = Route.get("/auth", (c) => {
	const Register = c.auth.passkey.register.form(register);
	const Login = c.auth.passkey.login.form(login);

	return (
		<>
			<Register />
			<Login />
		</>
	);
});

export const register = Route.post({ email: Field.email() }, async (c) => {
	const result = await c.data();
	if (result.issues) return c.redirect(result.url, 303);

	const credential = await c.auth.passkey.register.verify();
	// Store the user and credential in one transaction. Enforce unique credential IDs.
	await database.register({
		id: credential.user,
		email: result.data.email,
		credential,
	});

	await c.auth.login(credential.user);
	c.redirect("/account", 303);
});

export const login = Route.post(async (c) => {
	const credential = await c.auth.passkey.login.verify({
		find: (id) => database.findCredential(id),
		update: (next, previous) => database.updateCredential(next, previous),
	});

	await c.auth.login(credential.user);
	c.redirect("/account", 303);
});

export const logout = Route.post(async (c) => {
	await c.auth.logout();
	c.redirect(page, 303);
});
```

The `database` methods above represent your application's persistence layer. `update(next, previous)` must atomically compare the stored record with `previous`, save `next` only if it still matches, and return a boolean. Include the public key, owner, counter, and backup state in that comparison. Return false if the passkey was deleted or changed concurrently; do not recreate it. Persist the returned counter and backup state before granting a session. Authenticators that always report a zero counter are supported.

`Auth.Credential` contains `id`, `user`, `publicKey` (base64url SPKI), `counter`, `eligible`, and `backedUp`. These fields replace the earlier three-field draft format.

Use an options object to register for an existing user:

```ts
const Register = c.auth.passkey.register.form(register, {
	user: session.id,
	exclude: existingCredentialIds,
});
```

Use an opaque user ID of 1–64 UTF-8 bytes, never an email address. Registration generates a UUID when omitted. Both the page and the POST handler must require the current user's session when adding a passkey to an existing account. Validate ownership again in the POST handler; a previously rendered form is not authorization. Email syntax validation does not verify ownership of that email address.

`auth.session()` returns `{ id, token, expiration }` or `null`. `await auth.logout()` revokes the current session, invalidating copies of its cookie. `await auth.revoke(token)` revokes a selected session. Your session store can also revoke all sessions belonging to an account. Storage failures propagate so a failed revocation is not reported as a successful logout.

`App` automatically mounts `POST /_ovr/passkey/options`. Forms fetch fresh options at submission time. Signed bootstrap tokens expire after an hour and are bound to the browser cookie and configured origin. Each ceremony expires after one minute, is bound to its POST pathname and ceremony type, and is consumed on the first verification attempt, including failed attempts. Retrying the form obtains a fresh ceremony. Forms reserve the `credential` and `challenge` field names.

Forms include their own browser script and accessible error status. Multiple forms can target the same route independently. JavaScript and HTTPS are required. Handle `AuthIssue` and `Schema.AggregateIssue` in your application's error middleware to present registration or login failures.

The local docs demo is enabled **only in development**, with `AUTH_SECRET` (at least 32 random bytes) and `AUTH_ORIGIN` (the exact HTTPS origin). Serve it through HTTPS; the default origin is `https://localhost:5173`. Its in-memory stores are for local exploration and reset on restart.
