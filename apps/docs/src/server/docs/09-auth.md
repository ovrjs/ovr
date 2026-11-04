---
title: Auth
description: Passkey authentication with customizable forms, stored in your Postgres database.
---

`Auth` handles passkey registration, login, logout, and sessions. It stores its data in your Postgres [database](/08-database), and creates accounts in your users table. ovr supplies the verification, storage, rate limits, browser script, routes, and form components.

## Create

Create one `Auth` instance with your users table, and add it to the app with `app.use(auth)`. This mounts the authentication endpoints, and lets handlers read the session with `c.session()`.

```ts
import { App, Auth, Database, Field, Schema, Table } from "ovr";
import { Pool } from "pg";

const users = new Table("users", {
	id: Schema.string(),
	email: Field.email({ label: "Email" }),
});

const database = new Database(
	new Pool({ connectionString: process.env.DATABASE_URL }),
	[users, ...Auth.tables],
);

const auth = new Auth({
	secret,
	origin: "https://example.com",
	database,
	users,
});

const app = new App().use(auth);
```

`secret` is a server-side random secret containing at least 32 bytes. Keep it stable across deployments. `origin` is your exact HTTPS origin, without a path or trailing slash.

For secret rotation, pass `secret: [current, previous]`: new tokens use the first secret and existing tokens accept either. Remove the old secret after the session duration; keep the overlap at least one hour so open forms can finish. All instances must use the same list.

`database` is your application's [Database](/08-database). Include `Auth.tables` in its tables, and `database.migrate()` [creates them](#storage).

`users` is your users table, which must be in `database` too. Its form fields, other than `id` and columns with defaults, are the registration form. Columns with defaults, such as a `role` an admin form edits, are set by the server, so a signup cannot choose them. Registering inserts the account with its fields and a new ID, in the transaction that stores the first passkey, so both are saved or neither is. Its other columns, such as a creation date, need defaults or `null`. Do anything else a new account needs after registration, on the `redirect` page. The session is created after this transaction; if that fails, the account remains registered and the user can log in normally.

## Forms

Create your `/login` page with both forms. `Auth` supplies the POST endpoints; you supply this page. Use `page` to choose a different URL.

Call `auth.forms(c)` in the route handler, before returning JSX. This lets ovr set the browser-binding cookie before streaming begins.

```tsx
import { Route } from "ovr";

app.use(
	Route.get("/login").use((c) => {
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

Use field schemas for format checks. Enforce uniqueness with database constraints, where errors stay generic. `Field.email()` checks syntax; it does not verify ownership of an email address. The first field, here the email, labels the passkey in the user's password manager; it is not a verified identity.

## Sessions

Check the session before rendering a protected page:

```tsx
app.use(
	Route.get("/account").use(async (c) => {
		const session = await c.session();
		if (!session) return c.redirect("/login", 303);

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

`c.session()` returns the session, or `null` when nobody is signed in. Check it before anything private, and return a redirect to your authentication `page`; pages that are public but change for signed-in users render either way.

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

To revoke all sessions for a user, delete their rows: ``database.sql`DELETE FROM ${database.auth_sessions} WHERE ${database.auth_sessions.columns.user} = ${user}` ``. `auth.login(c, user)` is available for other flows where your application has already authenticated the user; passkey handlers call it automatically.

Resolve sessions and prepare forms before returning JSX. Doing this inside an async component is too late to reliably set cookies, redirects, or response status.

## Storage

`Auth.tables` are the tables Auth stores its data in. List them in your `Database`, and Auth's migrations come with them: [`database.migrate()`](/08-database#migrate) applies them, as `auth:1`, `auth:2`, and `rate_limits:1`, before your own, so your migrations can add foreign keys to them. [`database.check()`](/08-database#check) checks them with your tables. `new Auth()` throws when they are missing from its database.

```ts
const database = new Database(pool, [users, posts, ...Auth.tables]);

await database.migrate(files); // Auth's migrations, then your migrations/*.sql
```

A version's SQL never changes, so its checksum stays valid. Changes ship as a new version, which the next `database.migrate()` applies: `auth:2` added the table for [agents](#agents).

| Table              | Contents                                                      |
| ------------------ | ------------------------------------------------------------- |
| `auth_credentials` | Passkeys, with their owner, public key, counter, backup flags |
| `auth_sessions`    | Revocable sessions                                            |
| `auth_challenges`  | Outstanding ceremonies, each used once                        |
| `rate_limits`      | [Rate limit](/05-middleware#rate-limiting) buckets            |
| `auth_tokens`      | Agents' authorization codes and tokens, stored as hashes      |

Auth's user IDs are text: passkey registration creates random UUIDs, and `auth.login` accepts any ID. To delete an account's passkeys and sessions with it, give your `users` table a `text` ID and reference it in your own migration:

```sql
-- migrations/0003_auth_users.sql
ALTER TABLE auth_credentials ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
ALTER TABLE auth_sessions ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
```

The tables are available on your database by name, for example to list an account's passkeys:

```ts
const passkeys = await database.sql`
	SELECT * FROM ${database.auth_credentials} WHERE ${database.auth_credentials.columns.user} = ${user}
`.parse(database.auth_credentials);
```

Challenges are taken with one `DELETE ... RETURNING`, so each is used once even across instances, and credential updates match the previous record before saving. Expired challenges, sessions, and rate-limit buckets are deleted as new ones are written. Each browser can have 10 outstanding ceremonies, and all browsers together 10,000; [aggregate rate limits](#additional-limits) protect that capacity from abuse.

## Rate limiting

ovr supplies the per-client policies, stored in the `rate_limits` table.

| Operation    | Burst and refill rate |
| ------------ | --------------------- |
| Registration | 5 per 10 minutes      |
| Login        | 20 per minute         |

The default identity is the trusted client IP, with IPv6 grouped by `/64`. A ceremony makes two requests: options and verification have separate budgets. Registration options validate application fields, within a bounded 128 KB body, before the client policy, so field errors do not spend signup attempts. Other admission checks run before parsing; all run before challenge writes. Logout bypasses these policies, including limiter failures.

Every worker shares the database, so a fresh instance does not receive a fresh budget. See [Limiter](/05-middleware#rate-limiting) for middleware and custom identities.

Your server must supply the real client IP:

```ts
app.fetch(request, { ip });
```

A Fetch `Request` does not expose the socket peer. Use your server's connection metadata or a verified edge identity; do not trust arbitrary forwarded headers. See [client IP examples](/03-app#client-ip). Missing identity or unavailable storage denies authentication; it never disables limiting.

### Additional limits

`limits.register` and `limits.login` change the built-in client policies, for example `login: { limit: 10 }`; options you leave out keep their defaults. They take the same options as [`Limiter`](/05-middleware#rate-limiting), except `database`, which is Auth's; Auth names them.

**Public deployments need an aggregate ceiling to protect shared challenge capacity.** Per-client limits alone do not contain distributed callers. Enforce one at your edge, or check a shared [`Limiter`](/05-middleware#rate-limiting) on Auth's endpoints, `/auth/*` and `/_passkey/*`, before mounting `auth`:

```ts
const ceiling = new Limiter("auth:all", {
	database,
	limit: 100,
	key: () => "all",
});

app.use((c, next) => {
	const { pathname } = c.url;
	if (pathname.startsWith("/auth/") || pathname.startsWith("/_passkey/"))
		return ceiling.middleware(c, next);
	return next();
}, auth);
```

These numbers are an example. Size the burst and refill over the two-minute challenge lifetime against the challenge capacity and expected traffic. A shared ceiling counts legitimate users too, and it runs before the client policy, so a client that the client policy would block still spends shared tokens.

## Options

`Auth.Options` describes the complete configuration. `secret`, `origin`, `database`, and `users` are shown [above](#create), and `limits` under [rate limiting](#rate-limiting); these remaining options customize normal application behavior:

| Option            | Default         | Purpose                                           |
| ----------------- | --------------- | ------------------------------------------------- |
| `page`            | `/login`        | Your authentication page; failures redirect here. |
| `redirect`        | `/`             | Destination after registration or login.          |
| `duration`        | Seven days      | Fixed session lifetime in milliseconds.           |
| `consent`         | `/connect`      | Page where users approve [agents](#agents).       |
| `error(error, c)` | `console.error` | Detailed server-side error logging.               |

`page` and `redirect` must be local paths. `app.use(auth)` mounts the endpoints at fixed paths: `/auth/register`, `/auth/login`, and `/auth/logout`, with the passkey options endpoints and browser module under `/_passkey/`. The relying-party name shown by the browser comes from your origin's hostname.

Validation failures mark the affected fields. Expired or browser-mismatched form bootstraps return 410 and ask the user to reload. Other failures use generic messages, with guidance to log in if registration already completed. Detailed errors stay on the server; protocol validation failures are `Auth.Issue` instances. Rate-limit denials include a retry hint, and the client waits before retrying.

## Agents

Agents such as Claude or ChatGPT connect to the app's [MCP endpoint](/10-agents) and act as a user. The user signs in with their passkey in the browser and approves the agent with it; the agent receives OAuth tokens, never the passkey or a session cookie. Connecting agents requires Node.js or Bun, see below.

Pass `auth` to the [MCP endpoint](/10-agents#sign-in), which mounts the OAuth endpoints agents sign in with, and create the page where users approve them, `/connect` unless you set `consent`:

```tsx
const auth = new Auth(options);

const connect = Route.get("/connect")
	.describe(false)
	.use(async (c) => {
		if (!(await c.session())) return c.redirect("/login", 303);
		const request = await auth.consent(c);
		if (!request) return c.text("This request expired. Connect again.", 400);

		return (
			<>
				<h1>Connect {request.client.name}?</h1>
				<p>You will return to {request.redirect}.</p>
				<request.Form />
			</>
		);
	});

app.use(auth, new Mcp({ auth }), connect);
```

`request.Form` renders Allow and Deny buttons. Allow asks for the user's passkey, so a script or agent driving a signed-in browser cannot approve an agent for them, and the passkey must belong to the user who was asked. Deny needs no passkey. Pass your own buttons as `children`: the form's submit button allows, and a deny button submits to `/oauth/deny` with `formaction="/oauth/deny"`. The client name is chosen by the agent and not verified, so the page shows where the user will return. `auth.consent(c)` also sets headers that stop other sites from framing the page.

Auth then serves an OAuth 2.1 authorization server. Apps without an MCP endpoint given `auth` have none of these endpoints.

| Endpoint                                  | Purpose                                                     |
| ----------------------------------------- | ----------------------------------------------------------- |
| `/.well-known/oauth-authorization-server` | Metadata agents discover the endpoints with                 |
| `/oauth/authorize`                        | Signs the user in if needed, then shows your `consent` page |
| `/oauth/approve`                          | Allows the agent, confirmed with the user's passkey         |
| `/oauth/deny`                             | Denies the agent                                            |
| `/oauth/token`                            | Exchanges codes for tokens, and refreshes them              |

An agent's client ID is the HTTPS URL of its [client ID metadata document](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#client-id-metadata-documents), a JSON file with its name and the addresses to return the user to. Auth fetches it when the user connects, so the name shown on the consent page is tied to the agent's website, and there is nothing to register or store. The fetch never follows redirects, reads at most 5 KB, and refuses private and other special-use addresses. The address is checked when the connection looks the name up, so a domain cannot pass the check and then point at your network. Node.js and Bun can check the connection, so mounting `new Mcp({ auth })` throws in other runtimes.

Anyone can send a client ID, so downloads are limited: each IP can make 30 authorization requests per minute, each host serves at most 30 downloads per minute, and an instance downloads at most 16 documents at once. Requests for the same agent share one download, and a found agent is kept for 5 minutes.

Agents send the `resource` they will use the token with, such as the MCP endpoint URL, when they authorize and when they request tokens. Authorization requires PKCE with S256. Codes last a minute and are used once, access tokens last an hour, and refresh tokens last 30 days and are replaced each time they are used. Using a code or refresh token a second time revokes every token issued from it, since one of the two parties stole it. A token grants what the user can do, so requests with a `scope` are refused. Tokens are bound to the resource they were requested for, such as the MCP endpoint, and stored as SHA-256 hashes.

In a tool call, `c.session()` returns the session of the user who approved the agent, so the same handlers serve people and agents. `auth.bearer(c, resource)` reads a bearer token's session directly.

To list and disconnect an account's agents, query its refresh tokens:

```ts
const agents = await database.sql`
	SELECT DISTINCT ${database.auth_tokens.columns.client} FROM ${database.auth_tokens}
	WHERE ${database.auth_tokens.columns.user} = ${user} AND kind = 'refresh'
`;

await database.sql`
	DELETE FROM ${database.auth_tokens}
	WHERE ${database.auth_tokens.columns.user} = ${user} AND ${database.auth_tokens.columns.client} = ${client}
`;
```

Logging out does not disconnect agents. Token requests are limited to 60 per minute per client IP.

## Deployment

Use HTTPS and browsers with native WebAuthn JSON support. JavaScript is required. Passkey forms load an external same-origin module; nonce-based content security policies can pass `auth.forms(c, { nonce })`.

Every instance must use the same database and signing secrets. Set up aggregate limits and network overload protection at your edge.

Auth operations enforce the configured origin. Generated POST routes also require a same-origin `Sec-Fetch-Site` or matching `Origin`, even with `App` CSRF protection disabled. Cookies are host-wide, so use one authentication system per hostname. This implementation supports new-account registration with a first discoverable ES256/P-256 passkey. Adding more passkeys to an existing account and account recovery are not provided.
