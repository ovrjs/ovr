---
title: Auth
description: Passkey authentication with customizable forms, stored in your Postgres database.
---

`Auth` handles passkey registration, login, logout, and sessions. It stores its data in your Postgres [database](/database), and creates accounts in your users table. ovr supplies the verification, storage, rate limits, browser script, routes, and form components.

## Create

Create one `Auth` instance with your users table, and add it to the app with `app.use(auth)`. This mounts the authentication endpoints, and lets handlers read the session with `c.session()`. The examples on this page continue this one, using its `app` and `auth`.

```ts
import { App, Auth, Database, Field, Schema, Table } from "ovr";
import { Pool } from "pg";

const users = new Table("users", {
	id: Schema.string(),
	email: Field.email().label("Email"),
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

`secret` is a server-side random secret containing at least 32 bytes. Generate it once and set it as an environment variable, such as `AUTH_SECRET`:

```bash
node -e 'console.log(crypto.getRandomValues(new Uint8Array(32)).toHex())'
```

Keep it stable across deployments and the same on every instance: a new secret signs everyone out. `origin` is your exact HTTPS origin, without a path or trailing slash. In development, serve the app over HTTPS too, such as `https://localhost:5173` with a certificate your system trusts, from a tool like [mkcert](https://github.com/FiloSottile/mkcert); passkeys need the origin to match.

For secret rotation, pass `secret: [current, previous]`: new tokens use the first secret and existing tokens accept either. Remove the old secret after the session `lifetime`; keep the overlap at least one hour so open forms can finish. All instances must use the same list.

`database` is your application's [Database](/database). Include `Auth.tables` in its tables, and `database.migrate()` [creates them](#storage).

Auth limits sign-in per client IP, so your server must pass the trusted client IP when it calls the app, from its connection or a verified edge header, never an arbitrary forwarded header. See [client IP examples](/app#client-ip):

```ts
app.fetch(request, { ip });
```

`users` is your users table, which must be in `database` too. Its form fields, other than `id` and columns with defaults, are the registration form. Columns with defaults, such as a `role` an admin form edits, are set by the server, so a signup cannot choose them. Registering inserts the account with its fields and a new ID, in the transaction that stores the first passkey, so both are saved or neither is. Its other columns, such as a creation date, need defaults or `null`, otherwise passing the table is a type error. Do anything else a new account needs after registration, on the `redirect` page. The session is created after this transaction; if that fails, the account remains registered and the user can log in normally.

## Forms

Create your `/login` page with both forms. `Auth` supplies the POST endpoints; you supply this page. Use `page` to choose a different URL.

Call `auth.forms(c)` in the route handler, before returning JSX. This lets ovr set the browser-binding cookie before streaming begins.

```tsx
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
		<input id="email" required type="email" name="email" />
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
	<Register.Issue class="error" />
	<button>Create account</button>
</Register>
```

`Register.Field` renders one typed field; `Register.Fields` renders them all. `Login.Issue` customizes the login message. The forms accept normal HTML form attributes. Registration fields use the same [Field API](/schema#post-forms) as ordinary forms.

`<Register.Issue class="error" />` generates the following element. `Login.Issue` uses the same markup:

```html
<p role="status" aria-live="polite" class="error" data-passkey-error></p>
```

The browser script updates this status element and hides the default fallback when you supply your own. With custom form children, it also adds missing protocol inputs, so you only need to render your application fields and submit button.

Use field schemas for format checks: a field that fails one shows its own message, before the passkey prompt. Enforce uniqueness with database constraints, where errors stay generic, so registering with an email that has an account does not reveal it. A value anyone can see, such as a username, can say it is taken instead. Give its field the message with `taken()`, and registration checks it before the passkey prompt:

```ts
const users = new Table("users", {
	id: Schema.string(),
	email: Field.email(),
	username: Field.text().taken("Someone already has this username"),
});
```

The constraint is still the table's, in a migration. Two people registering the same username at once get the generic error, from the constraint. `Field.email()` checks syntax; it does not verify ownership of an email address. The first field, here the email, labels the passkey in the user's password manager; it is not a verified identity.

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

To bring the user back after they sign in, link to the page with `_return`, such as `/login?_return=/recipes/1`. `auth.forms(c)` reads it, and after registration or login the user goes there instead of `redirect`. Only a path of your own origin is followed; any other is ignored.

A session is `{ id, user, expiration }`. Use `user` to look up your account record. `id` identifies the session, and `expiration` is an absolute timestamp in milliseconds.

A session ends after a week without use, and renews while it is used: reading it moves its end out by another week, at most once a day. However often it is used, it ends 30 days after sign-in, and the user signs in again. Set these with `idle` and `lifetime`. Each request checks the database, so revocation and renewal apply across workers. The browser receives a signed, secure, HTTP-only cookie; session records stay in your database.

### Logout

`<Logout />` generates a normal form that revokes the current session. It needs no client script:

```html
<form action="/auth/logout" method="POST" enctype="multipart/form-data">
	<button>Log out</button>
</form>
```

You can also sign out the current session in a handler with `await auth.logout(c)`.

To sign out other sessions, such as from a list of the user's devices, or all of a user's sessions, delete their rows from `database.auth_sessions`. A deleted session ends on its next request:

```ts
await database.sql`
	DELETE FROM ${database.auth_sessions}
	WHERE ${database.auth_sessions.columns.user} = ${session.user}
`;
```

`auth.login(c, user)` is available for other flows where your application has already authenticated the user; passkey handlers call it automatically.

Resolve sessions and prepare forms before returning JSX. Doing this inside an async component is too late to reliably set cookies, redirects, or response status.

## Storage

`Auth.tables` are the tables Auth stores its data in. List them in your `Database`, and Auth's migrations come with them: [`database.migrate()`](/database#migrate) applies them, as `auth:1` and `rate_limits:1`, before your own, so your migrations can add foreign keys to them. [`database.check()`](/database#check) checks them with your tables. `new Auth()` is a type error when they or the users table are missing from its database.

Auth doesn't add its tables to the database itself, because a migration script may never create Auth, and its tables still need to be migrated.

```ts
const database = new Database(pool, [users, posts, ...Auth.tables]);

await database.migrate(files); // Auth's migrations, then your migrations/*.sql
```

A version's SQL never changes, so its checksum stays valid. Changes ship as a new version, such as `auth:2`, which the next `database.migrate()` applies.

| Table              | Contents                                                      |
| ------------------ | ------------------------------------------------------------- |
| `auth_credentials` | Passkeys, with their owner, public key, counter, backup flags |
| `auth_sessions`    | Revocable sessions                                            |
| `auth_challenges`  | Outstanding ceremonies, each used once                        |
| `rate_limits`      | [Rate limit](/middleware#rate-limiting) buckets               |
| `auth_tokens`      | Agents' authorization codes and tokens, stored as hashes      |

Auth's user IDs are text: passkey registration creates random UUIDs, and `auth.login` accepts any ID. Give your `users` table a `text` ID and reference it from all three of Auth's tables that belong to a user, in your own migration:

```sql
-- migrations/0003_auth_users.sql
ALTER TABLE auth_credentials ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
ALTER TABLE auth_sessions ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
ALTER TABLE auth_tokens ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
```

Then deleting the account deletes everything that signs in as it, whichever code deletes it: its passkeys, browser sessions, and agents' codes, access tokens, and refresh tokens. An agent refreshing its token at that moment cannot keep it.

[`database.check()`](/database#check) verifies these keys: each from the table's `user` column to your users table's `id`, cascading deletes, validated and enforced. It needs to know which table is your users table, so create `Auth` with the database before checking, for example by importing your auth module in the migration script; until then, `check` reports that it needs `Auth`.

```ts
await database.sql`
	DELETE FROM ${database.users} WHERE ${database.users.columns.id} = ${session.user}
`;
```

The tables are available on your database by name, for example to list an account's passkeys:

```ts
const passkeys = await database.sql`
	SELECT * FROM ${database.auth_credentials} WHERE ${database.auth_credentials.columns.user} = ${user}
`.parse(database.auth_credentials);
```

Challenges are taken with one `DELETE ... RETURNING`, so each is used once even across instances, and credential updates match the previous record before saving. Expired challenges, sessions, and rate-limit buckets are deleted periodically as new ones are written. Each browser can have 10 outstanding ceremonies, see [rate limiting](#rate-limiting).

## Rate limiting

Auth limits sign-in for you, per client, in the `rate_limits` table. The limits are fixed, since they protect Auth's own storage: the accounts it creates and the sign-in challenges it keeps.

| Request             | Limit per client |
| ------------------- | ---------------- |
| Registration        | 5 per 10 minutes |
| Login               | 20 per minute    |
| Agent authorization | 30 per minute    |
| Agent tokens        | 60 per minute    |

A client is its trusted IP, with IPv6 grouped by `/64`, from `app.fetch(request, { ip })`, see [Create](#create). A ceremony makes two requests: options and verification have separate budgets. Registration options validate application fields, within a bounded 128 KB body, before the limit, so field errors do not spend signup attempts. Other admission checks run before parsing; all run before challenge writes. Logout is never limited. Every worker shares the database, so a fresh instance does not receive a fresh budget. Missing identity or unavailable storage throws to your app; it never skips the limit.

Each browser can have 10 sign-in ceremonies outstanding; when they are used up, its new ceremonies are refused until some expire, two minutes after they start. There is no cap across browsers, which anyone with enough addresses could fill to lock everyone out; the per-IP limits bound each network instead. Floods from many addresses belong at your hosting edge. To limit your own routes, see [Limiter](/middleware#rate-limiting).

## Options

`Auth.Options` describes the complete configuration. `secret`, `origin`, `database`, and `users` are shown [above](#create); these remaining options customize normal application behavior:

| Option     | Default    | Purpose                                           |
| ---------- | ---------- | ------------------------------------------------- |
| `page`     | `/login`   | Your authentication page; failures redirect here. |
| `redirect` | `/`        | Destination after registration or login.          |
| `idle`     | Seven days | Time a session lasts unused, in milliseconds.     |
| `lifetime` | 30 days    | Time from sign-in a session lasts, at most.       |
| `consent`  | `/connect` | Page where users approve [agents](#agents).       |

`page`, `redirect`, and `consent` must be local paths of the app's own, such as `/login`, without a query or a trailing slash, and `page` cannot be one of Auth's endpoints: a path written in the options that is not one is a type error. `app.use(auth)` mounts the endpoints at fixed paths: `/auth/register`, `/auth/login`, and `/auth/logout`, with the passkey options endpoints and browser module under `/_passkey/`. The relying-party name shown by the browser comes from your origin's hostname.

Validation failures mark the affected fields. Expired or browser-mismatched form bootstraps return 410 and ask the user to reload. Failures the client caused, such as an expired challenge, an invalid passkey, or an account that already exists, return to the form with a generic message, with guidance to log in if registration already completed. Anything else, such as an unavailable database, is thrown to your app like an error from your own handler. Auth doesn't log. Rate-limit denials include a retry hint, and the client waits before retrying.

## Agents

Agents such as Claude or ChatGPT connect to the app's [MCP endpoint](/agents) and act as a user. The user signs in with their passkey in the browser and approves the agent with it; the agent receives OAuth tokens, never the passkey or a session cookie. Connecting agents requires Node.js or Bun, see below.

Pass `auth` to the [MCP endpoint](/agents#sign-in), which mounts the OAuth endpoints agents sign in with, and create the page where users approve them, `/connect` unless you set `consent`:

```tsx
const connect = Route.get("/connect").use(async (c) => {
	if (!(await c.session())) return c.redirect("/login", 303);
	const request = await auth.consent(c);
	if (!request) return c.text("This request expired. Connect again.", 400);

	return (
		<>
			<h1>Connect {request.client.name}?</h1>
			<p>
				Published by {new URL(request.client.id).origin}. It will be able to do
				anything you can do in this app. You will return to {request.redirect}.
			</p>
			<request.Form />
		</>
	);
});

app.use(new Mcp({ auth }), connect);
```

`request.Form` renders Allow and Deny buttons. Allow asks for the user's passkey, offering only theirs in the browser's picker, so a script or agent driving a signed-in browser cannot approve an agent for them, and the passkey must belong to the user who was asked. Deny needs no passkey. Pass your own buttons as `children`: the form's submit button allows, and a deny button submits to `/oauth/deny` with `formaction="/oauth/deny"`. The client name is chosen by the agent and not verified. `request.client.id` is the address of its metadata document, so its origin is who publishes the agent: show it, with where the user will return and what the agent can do. `auth.consent(c)` also sets headers that stop other sites from framing the page.

Auth then serves an OAuth 2.1 authorization server. Apps without an MCP endpoint given `auth` have none of these endpoints.

| Endpoint                                    | Purpose                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/.well-known/oauth-authorization-server`   | Metadata agents discover the endpoints with                                              |
| `/oauth/authorize`                          | Signs the user in if needed, then shows your `consent` page                              |
| `/oauth/approve`                            | Allows the agent, confirmed with the user's passkey                                      |
| `/_passkey/options/approve`                 | Starts the passkey prompt that confirms allowing the agent                               |
| `/oauth/deny`                               | Denies the agent                                                                         |
| `/oauth/token`                              | Exchanges codes for tokens, and refreshes them                                           |
| `/.well-known/oauth-protected-resource/mcp` | Metadata naming the MCP endpoint's authorization server, served by `Mcp` at its own path |

An agent's client ID is the HTTPS URL of its [client ID metadata document](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#client-id-metadata-documents), a JSON file with its name and the addresses to return the user to. Auth fetches it when the user connects, so the name shown on the consent page is tied to the agent's website, and there is nothing to register or store. The fetch never follows redirects, reads at most 5 KB, and refuses private and other special-use addresses. The address is checked when the connection looks the name up, so a domain cannot pass the check and then point at your network. Node.js and Bun can check the connection, so mounting `new Mcp({ auth })` throws in other runtimes. Agents are public clients: a document that declares only another way to authenticate, such as `private_key_jwt`, or only other grant or response types, is not accepted, and a token request that authenticates its client is refused.

A client ID and its document are accepted when:

- the client ID is an `https` URL with a path, without credentials or a fragment, written exactly as it parses;
- the document's `client_id` is that URL, and its `client_name`, if any, is shown trimmed to 100 characters, or the host when it is blank;
- `redirect_uris` lists at least one address, each `https`, `http` on a loopback address, where any port matches, or an app's own scheme, and none `javascript:`, `data:`, `file:`, `blob:`, `vbscript:`, or `about:`;
- it declares no sign-in method but `none`, and no grant or response types without `authorization_code` and `code`.

A download that fails for now, such as a timeout, a 5xx, or a 429, is tried again later, and a document that is invalid or too large is refused.

Anyone can send a client ID, so downloads are limited: each IP can make 30 authorization requests per minute and download 10 documents per minute from one host, a host serves at most 300 downloads per minute in all, and an instance downloads at most 16 documents at once, 2 for one IP. Requests for the same agent share one download, a found agent is kept for 5 minutes, and a client ID without a valid document is remembered for a minute. When a download is refused, or fails in a way that may pass, such as a timeout or a 5xx response, an agent found in the last hour is served from its last document, so floods of made-up client IDs or a short outage cannot lock out agents users already connect. A final answer, such as a 404 or an invalid document, forgets the agent at once. Errors in an authorization request are answered with a 400 page, not redirected to the agent, since anyone can publish a document naming any callback.

Agents send the `resource` they will use the token with, the URL of an MCP endpoint mounted with this `auth`, when they authorize and when they request tokens; any other URL is refused, even on your origin. Authorization requires PKCE with S256. Codes last a minute and are used once, and access tokens last an hour. Refresh tokens are replaced each time they are used, but a connection ends 30 days after the user approved it, however often the agent refreshes; then the user connects it again. Using a code or refresh token a second time revokes every token issued from it, since one of the two parties stole it. A token grants what the user can do, so requests with a `scope` are refused. Tokens are bound to the resource they were requested for, such as the MCP endpoint, and stored as SHA-256 hashes.

In a tool call, `c.session()` returns the session of the user who approved the agent, so the same handlers serve people and agents.

To list the signed-in user's agents, query their unexpired refresh tokens; a refresh token expires when its connection ends. Disconnect one with `auth.disconnect(c, client)`, passing one of the listed client IDs:

```ts
const agents = await database.sql`
	SELECT DISTINCT ${database.auth_tokens.columns.client} FROM ${database.auth_tokens}
	WHERE ${database.auth_tokens.columns.user} = ${session.user}
		AND ${database.auth_tokens.columns.kind} = 'refresh'
		AND ${database.auth_tokens.columns.expiration} > ${Date.now()}
`.parse(Schema.object({ client: Schema.string() }));

// for example, the agent the user chose from the list
const [{ client }] = agents;
await auth.disconnect(c, client);
```

Once it resolves, that agent's codes and tokens no longer work, including ones a refresh was issuing at the same moment, and connecting again needs the user's consent. Disconnect through Auth, not by deleting rows from `auth_tokens` yourself: a delete can miss tokens a refresh commits while it runs. `auth.disconnect` acts for the signed-in user, and throws without one.

Logging out does not disconnect agents. Token requests are limited to 60 per minute per client IP.

## Deployment

Use HTTPS and browsers with native WebAuthn JSON support. JavaScript is required. Passkey forms load an external same-origin module; nonce-based content security policies can pass `auth.forms(c, { nonce })`.

Every instance must use the same database and signing secrets. Set up network overload protection at your edge.

Auth operations enforce the configured origin: on another host, `c.session()` returns `null`, signing in or out and preparing forms throw, and Auth's endpoints answer 421. Generated POST routes also require a same-origin `Sec-Fetch-Site` or matching `Origin`, even with `App` CSRF protection disabled. Cookies are host-wide, so use one authentication system per hostname. This implementation supports new-account registration with a first discoverable ES256/P-256 passkey. Adding more passkeys to an existing account and account recovery are not provided.
