---
title: Auth
description: Passkey authentication with customizable forms, stored in your Postgres database.
---

`Auth` handles passkey registration, login, logout, and sessions. It stores its data in your Postgres [database](/09-database), and your application creates the accounts. ovr supplies the verification, storage, rate limits, browser script, routes, and form components.

## Create

Create one `Auth` instance and pass it to `App`. This mounts the authentication endpoints automatically.

```ts
import { App, Auth, Database, Field, Schema, Table } from "ovr";
import { Pool } from "pg";

const users = new Table("users", {
	id: Schema.string(),
	email: Schema.string().email(),
});

const db = new Database(
	new Pool({ connectionString: process.env.DATABASE_URL }),
	[users, ...Auth.tables],
);

const auth = new Auth({
	secret,
	origin: "https://example.com",
	database: db,
	register: {
		fields: { email: Field.email({ label: "Email" }) },
		name: ({ email }) => email,
		create: async (t, { email }, id) => {
			await t.sql`INSERT INTO ${users} ${t.sql.values(users, { id, email })}`;
		},
	},
});

const app = new App({ auth });
```

`secret` is a server-side random secret containing at least 32 bytes. Keep it stable across deployments. `origin` is your exact HTTPS origin, without a path or trailing slash.

For secret rotation, pass `secret: [current, previous]`: new tokens use the first secret and existing tokens accept either. Remove the old secret after the session duration; keep the overlap at least one hour so open forms can finish. All instances must use the same list.

`database` is your application's [Database](/09-database). Include `Auth.tables` in its tables, and create them with a [migration](#storage).

## Forms

Create your `/login` page with both forms. `Auth` supplies the POST endpoints; you supply this page. Use `page` to choose a different URL.

Call `auth.forms(c)` in the route handler, before returning JSX. This lets ovr set the browser-binding cookie before streaming begins.

```tsx
import { Route } from "ovr";

app.use(
	Route.get("/login", (c) => {
		const { Register, Login } = auth.forms(c);

		return (
			<>
				<h2>Log in</h2>
				<Login />
				<h2>Create account</h2>
				<Register />
			</>
		);
	}),
);
```

`Register` includes your registration fields, a submit button, and an accessible error message. `Login` opens the passkey picker without asking for an email or password. Both establish a session and redirect after success.

The forms automatically load a same-origin JavaScript module. It handles the passkey prompt, validation, errors, retries, and normal form submission, including forms arriving in a streamed response.

### Register

With the email field configured above, `<Register />` generates this HTML. Generated script IDs and signed bootstrap values are abbreviated in these examples.

```html
<form action="/auth/register" method="POST" enctype="multipart/form-data">
	<div>
		<label for="email">Email</label>
		<input id="email" type="email" name="email" />
	</div>
	<input type="hidden" name="credential" />
	<input type="hidden" name="ceremony" />
	<button>Create account</button>
	<p
		role="status"
		aria-live="polite"
		data-passkey-fallback
		data-passkey-error
	></p>
	<script
		id="passkey-register-id"
		type="module"
		src="/_passkey/client.js"
		data-passkey="register"
		data-endpoint="/_passkey/options/register"
		data-bootstrap="..."
	></script>
	<noscript>JavaScript is required for authentication.</noscript>
</form>
```

The hidden `credential` and `ceremony` inputs are filled by the browser script.

### Login

`<Login />` generates a form without account fields:

```html
<form action="/auth/login" method="POST" enctype="multipart/form-data">
	<input type="hidden" name="credential" />
	<input type="hidden" name="ceremony" />
	<button>Log in</button>
	<p
		role="status"
		aria-live="polite"
		data-passkey-fallback
		data-passkey-error
	></p>
	<script
		id="passkey-login-id"
		type="module"
		src="/_passkey/client.js"
		data-passkey="login"
		data-endpoint="/_passkey/options/login"
		data-bootstrap="..."
	></script>
	<noscript>JavaScript is required for authentication.</noscript>
</form>
```

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

`<Register.Error class="error" />` generates the following element. `Login.Error` uses the same markup:

```html
<p role="status" aria-live="polite" class="error" data-passkey-error></p>
```

The browser script updates this status element and hides the default fallback when you supply your own. With custom form children, it also adds missing protocol inputs, so you only need to render your application fields and submit button.

Use field schemas for format checks. Enforce uniqueness with database constraints, where errors stay generic. `Field.email()` checks syntax; it does not verify ownership of an email address. `register.name` provides a display label for the passkey provider, not a verified identity.

## Sessions

Require a session before rendering a protected page:

```tsx
app.use(
	Route.get("/account", async (c) => {
		const session = await auth.require(c);

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

`auth.require(c)` returns the session, or redirects to your authentication `page` and ends the request, so the rest of the handler only runs for signed-in users. On pages that are public but change for signed-in users, `auth.session(c)` returns the session or `null`.

A session is `{ id, user, expiration }`. Use `user` to look up your account record. `id` identifies the session, and `expiration` is an absolute timestamp in milliseconds.

Sessions last seven days by default, without extending on each request. Each request checks the database, so revocation applies across workers. The browser receives a signed, secure, HTTP-only cookie; session records stay in your database.

### Logout

`<Logout />` generates a normal form that revokes the current session. It needs no client script:

```html
<form action="/auth/logout" method="POST" enctype="multipart/form-data">
	<button>Log out</button>
</form>
```

You can also call these methods in a handler:

```ts
await auth.logout(c); // Current session.
await auth.revoke(c, id); // A selected session ID.
```

To revoke all sessions for a user, delete their rows: ``db.sql`DELETE FROM ${db.ovr_sessions} WHERE ${db.ovr_sessions.columns.user} = ${user}` ``. `auth.login(c, user)` is available for other flows where your application has already authenticated the user; passkey handlers call it automatically.

Resolve sessions and prepare forms before returning JSX. Doing this inside an async component is too late to reliably set cookies, redirects, or response status.

## Storage

`Auth.tables` are the tables Auth stores its data in. `Auth.sql[1]` is the SQL that creates them: add it to your migrations, under an ID you choose, so it runs in your order. [`db.check()`](/09-database#check) reports any table that is missing or different.

```ts
await db.migrate([
	...files, // your migrations/*.sql
	{ id: "0002_auth", sql: Auth.sql[1] },
]);
```

A version's SQL never changes, so its checksum stays valid. If a later ovr release changes the tables, it ships the change as `Auth.sql[2]` for you to add as a new migration.

| Table             | Contents                                                      |
| ----------------- | ------------------------------------------------------------- |
| `ovr_credentials` | Passkeys, with their owner, public key, counter, backup flags |
| `ovr_sessions`    | Revocable sessions                                            |
| `ovr_challenges`  | Outstanding ceremonies, each used once                        |
| `ovr_limits`      | [Rate limit](/05-middleware#rate-limiting) buckets            |

Auth's user IDs are text: passkey registration creates random UUIDs, and `auth.login` accepts any ID. To delete an account's passkeys and sessions with it, give your `users` table a `text` ID and reference it in your own migration:

```sql
-- migrations/0003_auth_users.sql
ALTER TABLE ovr_credentials ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
ALTER TABLE ovr_sessions ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
```

The tables are available on your database by name, for example to list an account's passkeys:

```ts
const passkeys = await db.sql`
	SELECT * FROM ${db.ovr_credentials} WHERE ${db.ovr_credentials.columns.user} = ${user}
`.parse(db.ovr_credentials);
```

`register.create(t, data, user)` receives your validated fields and the new account's ID. Insert the account with `t`: it runs in the transaction that stores the first credential, so both are saved or neither is. Never upsert an existing account. The session is created after this transaction; if that fails, the account remains registered and the user can log in normally.

Challenges are taken with one `DELETE ... RETURNING`, so each is used once even across instances, and credential updates match the previous record before saving. Expired challenges, sessions, and rate-limit buckets are deleted as new ones are written. Each browser can have 10 outstanding ceremonies, and all browsers together 10,000; [aggregate rate limits](#additional-limits) protect that capacity from abuse.

## Rate limiting

ovr supplies the per-client policies, stored in the `ovr_limits` table.

| Operation    | Burst and refill rate |
| ------------ | --------------------- |
| Registration | 5 per 10 minutes      |
| Login        | 20 per minute         |

The default identity is the trusted client IP, with IPv6 grouped by `/64`. A ceremony makes two requests: options and verification have separate budgets. The optional guard runs before parsing the bounded 128 KB body. Registration options validate application fields before the client and extra policies, so field errors do not spend signup attempts. Other admission checks run before parsing; all run before challenge writes. Logout bypasses these policies, including limiter failures.

Every worker shares the database, so a fresh instance does not receive a fresh budget. See [Limiter](/05-middleware#rate-limiting) for middleware and custom identities.

Your server must supply the real client IP:

```ts
app.fetch(request, { ip });
```

A Fetch `Request` does not expose the socket peer. Use your server's connection metadata or a verified edge identity; do not trust arbitrary forwarded headers. See [client IP examples](/03-app#client-ip). Missing identity or unavailable storage denies authentication; it never disables limiting.

### Additional limits

**Public deployments need aggregate admission ceilings to protect shared challenge capacity.** Per-client limits alone do not contain distributed callers or clients rotating through larger IPv6 allocations. Add shared policies with `limits.extra`, or enforce equivalent limits at the edge.

Policies take the same options as [`Limiter`](/05-middleware#rate-limiting), except `database` and `error`: Auth stores them in its database and reports failures through its own `error` option.

```ts
new Auth({
	...options,
	limits: {
		extra: [
			{
				name: `auth:all:${options.origin}`,
				limit: 100,
				interval: 60000,
				key: () => "all",
			},
		],
	},
});
```

These numbers are an example. Size the combined burst and refill over the two-minute challenge lifetime against the challenge capacity and expected traffic. Shared quotas combine legitimate users too.

Extra policies run after the client policy, in array order, and preserve its defaults. Earlier checks keep their consumed tokens when a later check denies. `limits.register` and `limits.login` change the built-in client policies, for example `login: { limit: 10 }`; options you leave out keep their defaults. An optional `limits.guard` runs first to bound bucket creation; it counts rejected attempts too and can lock out everyone if exhausted. Keep it well above normal traffic, or use edge protection for that purpose.

## Options

`Auth.Options<Shape>` describes the complete configuration. `database` and `register` are shown above, and `limits` under [rate limiting](#rate-limiting); these remaining options customize normal application behavior:

| Option            | Default          | Purpose                                           |
| ----------------- | ---------------- | ------------------------------------------------- |
| `page`            | `/login`         | Your authentication page; failures redirect here. |
| `redirect`        | `/`              | Destination after registration or login.          |
| `duration`        | Seven days       | Fixed session lifetime in milliseconds.           |
| `paths.register`  | `/auth/register` | Registration POST endpoint.                       |
| `paths.login`     | `/auth/login`    | Login POST endpoint.                              |
| `paths.logout`    | `/auth/logout`   | Logout POST endpoint.                             |
| `error(error, c)` | `console.error`  | Detailed server-side error logging.               |

Paths must be distinct local paths. The options endpoints and browser module are fixed under `/_passkey/`; `App` mounts them for you. The relying-party name shown by the browser comes from your origin's hostname.

Validation failures mark the affected fields. Expired or browser-mismatched form bootstraps return 410 and ask the user to reload. Other failures use generic messages, with guidance to log in if registration already completed. Detailed errors stay on the server; protocol validation failures are `Auth.Issue` instances. Rate-limit denials include a retry hint, and the client waits before retrying.

## Deployment

Use HTTPS and browsers with native WebAuthn JSON support. JavaScript is required. Passkey forms load an external same-origin module; nonce-based content security policies can pass `auth.forms(c, { nonce })`.

Every instance must use the same database and signing secrets. Set up aggregate limits and network overload protection at your edge.

Auth operations enforce the configured origin. Generated POST routes also require a same-origin `Sec-Fetch-Site` or matching `Origin`, even with `App` CSRF protection disabled. Cookies are host-wide, so use one authentication system per hostname. This implementation supports new-account registration with a first discoverable ES256/P-256 passkey. Adding more passkeys to an existing account and account recovery are not provided.
