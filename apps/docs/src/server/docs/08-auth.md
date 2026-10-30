---
title: Auth
description: Passkey authentication with customizable forms and your own database.
---

`Auth` handles passkey registration, login, logout, and sessions. You provide storage functions using your database or ORM; ovr supplies the verification, browser script, routes, and form components.

## Create

Create one `Auth` instance and pass it to `App`. This mounts the authentication endpoints automatically.

```ts
import * as db from "./db";
import { App, Auth, Field } from "ovr";

const auth = new Auth({
	secret,
	origin: "https://example.com",
	redirect: "/account",
	challenges: { set: db.saveChallenge, take: db.takeChallenge },
	sessions: {
		set: db.saveSession,
		get: db.getSession,
		delete: db.deleteSession,
	},
	credentials: { get: db.getCredential, update: db.updateCredential },
	limits: { consume: db.consumeToken },
	register: {
		fields: { email: Field.email({ label: "Email" }) },
		name: ({ email }) => email,
		create: db.createUser,
	},
});

const app = new App({ auth });
```

`secret` is a server-side random secret containing at least 32 bytes. Keep it stable across deployments. `origin` is your exact HTTPS origin, without a path or trailing slash.

`./db` is your application's database module. Implement its functions using the [storage contracts](#storage) below; no adapter class or database integration package is required.

## Forms

Call `auth.forms(c)` in the route handler, before returning JSX. This lets ovr set the browser-binding cookie before streaming begins.

```tsx
import { Route } from "ovr";

app.use(
	Route.get("/auth", (c) => {
		const { Register, Login } = auth.forms(c);

		return (
			<>
				<Register />
				<Login />
			</>
		);
	}),
);
```

`Register` includes your registration fields, a submit button, and an accessible error message. `Login` opens the passkey picker without asking for an email or password. Both establish a session and redirect after success.

The forms automatically load a same-origin JavaScript module. It handles the passkey prompt, validation, errors, retries, and normal form submission, including forms arriving in a streamed response.

### Customization

Supply children to control the markup and styling:

```tsx
<Register class="stack">
	<Register.Field name="email" />
	<Register.Error class="error" />
	<button>Create account</button>
</Register>
```

`Register.Field` renders one typed field; `Register.Fields` renders them all. `Login.Error` customizes the login message. The forms accept normal HTML form attributes. Registration fields use the same [Field API](/07-schema#post-forms) as ordinary forms.

Use field schemas for format checks. Enforce uniqueness in `register.create` and database constraints, where errors stay generic. `Field.email()` checks syntax; it does not verify ownership of an email address. `register.name` provides a display label for the passkey provider, not a verified identity.

## Sessions

Read the session before rendering a protected page:

```tsx
app.use(
	Route.get("/account", async (c) => {
		const session = await auth.session(c);
		if (!session) return c.redirect("/auth", 303);

		const { Logout } = auth.forms(c);

		return (
			<>
				<p>Signed in as {session.user}</p>
				<Logout />
			</>
		);
	}),
);
```

`auth.session(c)` returns `{ id, user, expiration }` or `null`. Use `user` to look up your account record. `id` identifies the session, and `expiration` is an absolute timestamp in milliseconds.

Sessions last seven days by default, without extending on each request. Each request checks shared storage, so revocation applies across workers. The browser receives a signed, secure, HTTP-only cookie; session records stay in your database.

`Logout` submits a normal form and revokes the current session. You can also call these methods in a handler:

```ts
await auth.logout(c); // Current session.
await auth.revoke(c, id); // A selected session ID.
```

To revoke all sessions for a user, delete their session records in your database. `auth.login(c, user)` is available for other flows where your application has already authenticated the user; passkey handlers call it automatically.

Resolve sessions and prepare forms before returning JSX. Doing this inside an async component is too late to reliably set cookies, redirects, or response status.

## Storage

All instances must share the same database and signing secret. Callbacks may be synchronous or asynchronous. Storage failures must throw.

| Callback                             | What your application must do                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `challenges.set(id, value)`          | Save until `value.expiration`. Return `false` if capacity is exhausted.                                         |
| `challenges.take(id)`                | Atomically return and delete the challenge, or return nothing. Only one concurrent caller may receive it.       |
| `sessions.set(id, value)`            | Save the session before its cookie is issued.                                                                   |
| `sessions.get(id)`                   | Return the session, or nothing if missing, expired, or revoked.                                                 |
| `sessions.delete(id)`                | Delete the session.                                                                                             |
| `credentials.get(id)`                | Return the credential, or nothing if missing.                                                                   |
| `credentials.update(next, previous)` | Save `next` only if the stored record still matches every field in `previous`. Return whether a record matched. |
| `register.create(data, credential)`  | Insert a new user and their first credential together in a transaction.                                         |

Use the exported `Auth.Challenge`, `Auth.Session`, and `Auth.Credential` types for your storage functions. Persist the complete credential, including its owner, public key, counter, and backup flags. Enforce unique user, credential, and session IDs and their relationships in the database.

### Atomic operations

`challenges.take` must consume the challenge in one operation, such as `DELETE ... RETURNING`, or a transaction that locks the record. A separate read followed by a delete allows replay.

`credentials.update` is a compare-and-swap operation. Match the ID, owner, public key, counter, and backup flags before updating. Return `true` for a matched record even when no values changed; use matched rows or `RETURNING`, rather than changed-row counts. Return `false` for a concurrent change or deletion. Never recreate a deleted credential.

`register.create` receives your validated fields and a credential whose `user` is a new opaque user ID. Insert that user and credential together; never upsert an existing account. Session creation follows this transaction. If saving the session fails, the account remains registered and the user can log in normally.

### Expiration and capacity

Clean up expired challenges, sessions, and rate-limit buckets in shared storage. Bound outstanding challenges and deny new writes when full. A storage cap bounds memory or database growth; [aggregate rate limits](#additional-limits) protect that capacity from abuse.

## Rate limiting

ovr supplies the per-client policies. You supply the shared atomic storage operation in `limits.consume`.

| Operation    | Burst and refill rate |
| ------------ | --------------------- |
| Registration | 5 per 10 minutes      |
| Login        | 20 per minute         |

The default identity is the trusted client IP, with IPv6 grouped by `/64`. A ceremony makes two requests: options and verification have separate budgets. Admission happens before body parsing and challenge writes. Logout bypasses these policies, including limiter failures.

`db.consumeToken(key, { limit, interval })` must atomically refill the token bucket and consume one token. Return literal `true` on admission or a positive absolute retry timestamp in milliseconds on denial. Every worker must share the same storage and policy. There is no in-memory fallback. See [Limiter](/05-middleware#rate-limiting) for backend keys, middleware, and custom identities.

Your server must supply the real client IP:

```ts
app.fetch(request, { ip });
```

A Fetch `Request` does not expose the socket peer. Use your server's connection metadata or a verified edge identity; do not trust arbitrary forwarded headers. See [client IP examples](/03-app#client-ip). Missing identity or unavailable storage denies authentication; it never disables limiting.

### Additional limits

**Public deployments need aggregate admission ceilings to protect shared challenge capacity.** Per-client limits alone do not contain distributed callers or clients rotating through larger IPv6 allocations. Add shared policies with `limits.extra`, or enforce equivalent limits at the edge.

```ts
import * as db from "./db";
import { Auth, Limiter } from "ovr";

new Auth({
	...options,
	limits: {
		consume: db.consumeToken,
		extra: [
			new Limiter({
				name: `auth:all:${options.origin}`,
				limit: 100,
				interval: 60000,
				key: () => "all",
				consume: db.consumeToken,
			}),
		],
	},
});
```

These numbers are an example. Size the combined burst and refill over the two-minute challenge lifetime against your storage cap and expected traffic. Shared quotas combine legitimate users too.

Extra policies run after the client policy, in array order, and preserve its defaults. Earlier checks keep their consumed tokens when a later check denies. `limits.register` and `limits.login` replace the corresponding client policy. An optional `limits.guard` runs first to bound bucket creation; it counts rejected attempts too and can lock out everyone if exhausted. Keep it well above normal traffic, or use edge protection for that purpose.

## Options

`Auth.Options<Shape>` describes the complete configuration. The storage and registration callbacks are shown above; these remaining options customize normal application behavior:

| Option            | Default          | Purpose                                           |
| ----------------- | ---------------- | ------------------------------------------------- |
| `page`            | `/auth`          | Your authentication page; failures redirect here. |
| `redirect`        | `/`              | Destination after registration or login.          |
| `duration`        | Seven days       | Fixed session lifetime in milliseconds.           |
| `paths.register`  | `/auth/register` | Registration POST endpoint.                       |
| `paths.login`     | `/auth/login`    | Login POST endpoint.                              |
| `paths.logout`    | `/auth/logout`   | Logout POST endpoint.                             |
| `error(error, c)` | `console.error`  | Detailed server-side error logging.               |

Paths must be distinct local paths. The options endpoints and browser module are fixed under `/_ovr/passkey/`; `App` mounts them for you. The relying-party name shown by the browser comes from your origin's hostname.

Validation failures mark the affected fields. Other failures use generic messages, with guidance to log in if registration already completed. Detailed errors stay on the server; protocol validation failures are `Auth.Issue` instances. Rate-limit denials include a retry hint, and the client waits before retrying.

## Deployment

Use HTTPS, the latest Node.js LTS release, and current browsers with native WebAuthn JSON support. JavaScript is required. Passkey forms load an external same-origin module; nonce-based content security policies can pass `auth.forms(c, { nonce })`.

Production storage must be reachable from every instance. An in-memory map or a serverless function's local SQLite file cannot provide shared persistence. Set up expiration cleanup, capacity monitoring, aggregate limits, and network overload protection at your edge.

Auth operations enforce the configured origin. Cookies are host-wide, so use one authentication system per hostname. This implementation supports new-account registration with a first discoverable ES256/P-256 passkey. Adding more passkeys to an existing account, account recovery, and signing-key rotation are not provided.
