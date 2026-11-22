---
title: Auth
description: Passkey authentication with customizable forms, stored in your Postgres database.
---

`Auth` handles passkey registration, login, logout, and sessions, [adding a passkey](#add-a-passkey) to an account, and one-time [sign-in links](#sign-in-link). It stores its data in your Postgres [database](/database), and creates accounts in your users table. ovr supplies the verification, storage, rate limits, browser script, routes, and form components.

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
		const { register, login } = auth.forms(c);

		return (
			<>
				<h2>Log in</h2>
				<login.Form />
				<h2>Create account</h2>
				<register.Form />
			</>
		);
	}),
);
```

`register.Form` includes your registration fields, a submit button, and an accessible error message. `login.Form` opens the passkey picker without asking for an email or password. Both establish a session and redirect after success. `auth.forms(c)` also has `add`, `link`, and `logout`, each described below. Each is a form as a [route's](/schema#post-forms) is: its `Form`, and the parts to lay it out yourself.

The forms automatically load a same-origin JavaScript module. It handles the passkey prompt, validation, errors, retries, and normal form submission, including forms arriving in a streamed response.

### Register

With the email field configured above, `<register.Form />` generates this HTML. Generated script IDs and signed bootstrap values are abbreviated in these examples.

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
		src="https://example.com/_passkey/client.js"
		data-passkey="register"
		data-endpoint="/_passkey/options/register"
		data-bootstrap="..."
	></script>
	<noscript>JavaScript is required for authentication.</noscript>
</form>
```

The hidden `credential` and `ceremony` inputs are filled by the browser script.

### Login

`<login.Form />` generates a form without account fields:

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
		src="https://example.com/_passkey/client.js"
		data-passkey="login"
		data-endpoint="/_passkey/options/login"
		data-bootstrap="..."
	></script>
	<noscript>JavaScript is required for authentication.</noscript>
</form>
```

### Add a passkey

An account has the passkey it registered with. `<add.Form />` adds another to the account signed in, such as for a second device, or one that replaces a device that was lost. Render it on a page of the account, which it returns to:

```tsx
app.use(
	Route.get("/account/passkeys").use(
		auth.guard(async (c) => {
			const { add } = auth.forms(c);
			const passkeys = await auth.passkeys(c);

			return (
				<>
					<ul>
						{passkeys.map((passkey) => (
							<li>
								{passkey.name ?? "Passkey"}
								{passkeys.length > 1 && (
									<remove.Form>
										<input type="hidden" name="id" value={passkey.id} />
										<button>Remove</button>
									</remove.Form>
								)}
							</li>
						))}
					</ul>
					<add.Form />
				</>
			);
		}),
	),
);
```

The form has one optional field, the passkey's name, such as "Laptop", and its button is "Add passkey". Its `add.Issue` is customized as the others are. With children of your own, write the field yourself, `<input name="name" maxlength="64" />`, or leave it out. The passkey is for the same account, so either signs in as it, and an authenticator that already holds one of the account's is not asked to make another. A passkey outlasts the session that adds it, so adding one asks for a recent sign-in: within ten minutes, in that browser. After that, the form first asks for a passkey the person already has, which starts their session again, and they press the button once more to add the new one. They do not sign out. Without a session the prompt is refused with a 401.

`auth.passkeys(c)` lists the signed-in user's passkeys, oldest first. Each has what tells it apart in a list:

| Property  | What it holds                                                              |
| --------- | -------------------------------------------------------------------------- |
| `id`      | Its ID, which `remove` takes                                               |
| `name`    | What the person called it when adding it, or `null`                        |
| `created` | When it was made, in milliseconds                                          |
| `origin`  | The origin it was made at. It signs in at its hostname, on any port        |
| `synced`  | `true` when a password manager keeps a copy, so losing the device keeps it |

`auth.remove(c, id)` removes one, such as for a device the person no longer has, signs them out everywhere else and disconnects their agents. An agent cannot call it. It keeps the account's last passkey, since nothing else signs in as it, and returns `false` then, or for an ID that is not one of theirs:

```ts
const remove = Route.post("/account/passkeys/remove")
	.fields({ id: Field.hidden() })
	.use(
		auth.guard(async (c) => {
			const result = await c.data();
			if (!result.issues) await auth.remove(c, result.data.id);

			return c.redirect("/account/passkeys", 303);
		}),
	);
```

Both throw when nobody is signed in.

### Sign-in link

A passkey belongs to the site it was made on. An account made at one origin, such as `localhost`, has none at another that shares its database, such as the production domain, and someone who lost their only device has none at all. `auth.link` makes a link that signs a user in once, so they can add a passkey:

```tsx
// signed in at the first origin, or in an admin script
const link = await auth.link(session.user, {
	origin: "https://example.com", // where it is opened, this origin by default
});
```

`origin` must be an HTTPS origin with no path, or `auth.link` throws. The link opens your authentication `page` at that origin, and its address holds the token, so keep other sites' scripts off that page. Render `<link.Form />` there, from `auth.forms(c)`: it is a "Sign in" button, so opening the link signs nobody in, and a preview or a prefetch cannot use it up. On a page opened without a link it renders nothing.

```tsx
const { login, link } = auth.forms(c);

<>
	<link.Form />
	<login.Form />
</>;
```

A link works once, for five minutes, only at the origin it was made for, and only its hash is stored, in `auth_links`. A link that is used, expired, or for another origin returns to the page, where `link.Issue` says so. Anyone who has the link is the user until then: make one only for a user your code has already identified, and send it the way you would a password.

A link signs in without a passkey, so it is the weakest way into an account. Keep it for yourself: make links from a script or an admin page, such as to move your own account from `localhost` to production, or to let someone back in after you have checked who they are. A form that lets any signed-in user make one is probably not worth having in production, since whoever takes over a session there can make a way in that outlasts it.

### Customization

Supply children to control the markup and styling:

```tsx
<register.Form class="stack">
	<register.Field name="email" />
	<register.Issue class="error" />
	<button>Create account</button>
</register.Form>
```

`register.Field` renders one typed field; `register.Fields` renders them all. `login.Issue` customizes the login message. The forms accept normal HTML form attributes. Registration fields use the same [Field API](/schema#post-forms) as ordinary forms.

`<register.Issue class="error" />` generates the following element. `login.Issue` uses the same markup:

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

Registration stores what the person typed. A column cannot take `preprocess()`, since it would run on stored values as they are read, so have the field reject a form you don't want stored, and say why. A username that should be lowercase without its `@`:

```ts
Field.text().refine(
	(value) => /^[a-z0-9_]+$/.test(value),
	"Lowercase letters, numbers and _ only, without the @",
);
```

## Sessions

Wrap a route that needs someone signed in with `auth.guard`:

```tsx
app.use(
	Route.get("/account").use(
		auth.guard(async (c) => {
			const session = await c.session();
			const { logout } = auth.forms(c);

			return (
				<>
					<p>Signed in as {session.user}</p>
					<logout.Form />
				</>
			);
		}),
	),
);
```

Anyone who is not signed in is redirected to your authentication `page`, and comes back once they sign in: to the page they asked for, or to the page the form they sent was on. In the guard `c.session()` is never `null`, so a handler that writes for the user, such as a POST, reads them without a check.

`c.session()` returns the session, or `null` when nobody is signed in. Read it on a page that is public but changes for signed-in users, and in a [component](/render#context), which can be on any page:

```tsx
async function Greeting(_props: {}, c: Context) {
	const session = await c.session();
	if (!session) return <a href="/login">Sign in</a>;

	return <p>Signed in as {session.user}</p>;
}
```

A redirect is the route's to make, before the page starts: a component runs once the response has begun.

To bring the user back after they sign in yourself, link to the page with `_return`, such as `/login?_return=/recipes/1`. `auth.forms(c)` reads it, and after registration or login the user goes there instead of `redirect`. Only a path of your own origin is followed; any other is ignored.

A session is `{ id, user, expiration }`, typed `Context.Session`. Use `user` to look up your account record. `id` identifies the session, and `expiration` is an absolute timestamp in milliseconds.

When an [agent](/agents#sign-in) makes the request for the user, the session also has `agent`: its `id`, which [`auth.disconnect`](#agents) takes, and the `name` it gave itself. A person's own request has none, so a handler can tell the two apart, such as to keep a log of what each connected agent changed.

A session ends after a week without use, and renews while it is used: reading it moves its end out by another week, at most once a day. However often it is used, it ends 30 days after sign-in, and the user signs in again. Set these with `idle` and `lifetime`. Each request checks the database, so revocation and renewal apply across workers. The browser receives a signed, secure, HTTP-only cookie; session records stay in your database.

A response to a browser that sends the session cookie is `Cache-Control: no-store`, set before the route runs, so no cache keeps a signed-in page. That holds wherever the session is read: a [component](/render#context) can read it with `c.session()` while the page streams. A route that reads no session can set its own `Cache-Control`, such as for an image.

### Logout

`<logout.Form />` generates a normal form that revokes the current session. It needs no client script:

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

Prepare forms with `auth.forms(c)`, and make any redirect, in the handler before returning JSX. A component runs once the response has begun, which is too late to set a cookie or redirect, so its `Context` has no way to: `auth.forms(c)` there is a type error. Reading `c.session()` in a component is fine.

## Storage

`Auth.tables` are the tables Auth stores its data in. List them in your `Database`, and Auth's migrations come with them: [`database.migrate()`](/database#migrate) applies them, as `auth:1` and `rate_limits:1`, before your own, so your migrations can add foreign keys to them. [`database.check()`](/database#check) checks them with your tables. `new Auth()` is a type error when they or the users table are missing from its database.

Auth doesn't add its tables to the database itself, because a migration script may never create Auth, and its tables still need to be migrated.

```ts
const database = new Database(pool, [users, posts, ...Auth.tables]);

await database.migrate(files); // Auth's migrations, then your migrations/*.sql
```

A version's SQL never changes, so its checksum stays valid. Changes ship as a new version, such as `auth:2`, which the next `database.migrate()` applies.

| Table              | Contents                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `auth_credentials` | Passkeys, with their owner, public key, counter, backup flags, and when, where, and by what name each was made |
| `auth_sessions`    | Revocable sessions                                                                                             |
| `auth_challenges`  | Outstanding ceremonies, each used once                                                                         |
| `rate_limits`      | [Rate limit](/middleware#rate-limiting) buckets                                                                |
| `auth_tokens`      | Agents' authorization codes and tokens, stored as hashes                                                       |
| `auth_links`       | One-time [sign-in links](#sign-in-link), stored as hashes                                                      |

Auth's user IDs are text: passkey registration creates random UUIDs, and `auth.login` accepts any ID. Give your `users` table a `text` ID and reference it from each of Auth's tables that belong to a user, in your own migration:

```sql
-- migrations/0003_auth_users.sql
ALTER TABLE auth_credentials ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
ALTER TABLE auth_sessions ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
ALTER TABLE auth_tokens ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
ALTER TABLE auth_links ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
```

Then deleting the account deletes everything that signs in as it, whichever code deletes it: its passkeys, browser sessions, sign-in links, and agents' codes, access tokens, and refresh tokens. An agent refreshing its token at that moment cannot keep it.

[`database.check()`](/database#check) verifies these keys: each from the table's `user` column to your users table's `id`, cascading deletes, validated and enforced. It needs to know which table is your users table, so create `Auth` with the database before checking, for example by importing your auth module in the migration script; until then, `check` reports that it needs `Auth`.

```ts
await database.sql`
	DELETE FROM ${database.users} WHERE ${database.users.columns.id} = ${session.user}
`;
```

The tables are available on your database by name, for what Auth has no method for, such as how many passkeys every account has:

```ts
const { auth_credentials } = database;

const counts = await database.sql`
	SELECT ${auth_credentials.columns.user}, count(*)::int AS passkeys
	FROM ${auth_credentials} GROUP BY ${auth_credentials.columns.user}
`;
```

Challenges are taken with one `DELETE ... RETURNING`, so each is used once even across instances, and credential updates match the previous record before saving. Expired challenges, sessions, sign-in links, and rate-limit buckets are deleted periodically as new ones are written. Each browser can have 10 outstanding ceremonies, see [rate limiting](#rate-limiting).

## Rate limiting

Auth limits sign-in for you, per client, in the `rate_limits` table. The limits are fixed, since they protect Auth's own storage: the accounts it creates and the sign-in challenges it keeps.

| Request             | Limit per client |
| ------------------- | ---------------- |
| Registration        | 5 per 10 minutes |
| Login               | 20 per minute    |
| Adding a passkey    | 5 per 10 minutes |
| Sign-in link        | Counts as login  |
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

`page`, `redirect`, and `consent` must be local paths of the app's own, such as `/login`, without a query or a trailing slash, and `page` cannot be one of Auth's endpoints: a path written in the options that is not one is a type error. `app.use(auth)` mounts the endpoints at fixed paths: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/passkey`, `/auth/confirm`, and `/auth/link`, with the passkey options endpoints and browser module under `/_passkey/`. The relying-party name shown by the browser comes from your origin's hostname.

Validation failures mark the affected fields. Expired or browser-mismatched form bootstraps return 410 and ask the user to reload. Failures the client caused, such as an expired challenge, an invalid passkey, or an account that already exists, return to the form with a generic message, with guidance to log in if registration already completed. Anything else, such as an unavailable database, is thrown to your app like an error from your own handler. Auth doesn't log. Rate-limit denials include a retry hint, and the client waits before retrying.

## Agents

Agents such as Claude or ChatGPT connect to the app's [MCP endpoint](/agents) and act as a user. The user signs in with their passkey in the browser and approves the agent with it; the agent receives OAuth tokens, never the passkey or a session cookie. Connecting agents requires Node.js or Bun, see below.

Pass `auth` to the [MCP endpoint](/agents#sign-in), which mounts the OAuth endpoints agents sign in with, and create the page where users approve them, `/connect` unless you set `consent`:

```tsx
const connect = Route.get("/connect").use(
	auth.guard(async (c) => {
		const request = await auth.consent(c);
		if (!request) return c.text("This request expired. Connect again.", 400);

		return (
			<>
				<h1>Connect {request.client.name}?</h1>
				<p>
					Published by {new URL(request.client.id).origin}. It will be able to
					do anything you can do in this app. You will return to{" "}
					{request.returns}.
				</p>
				<request.Form />
			</>
		);
	}),
);

app.use(new Mcp({ auth }), connect);
```

`request.Form` renders Allow and Deny buttons. Allow asks for the user's passkey, offering only theirs in the browser's picker, so a script or agent driving a signed-in browser cannot approve an agent for them, and the passkey must belong to the user who was asked. Deny needs no passkey. Pass your own buttons as `children`: the form's submit button allows, and a deny button submits to `/oauth/deny` with `formaction="/oauth/deny"`. The client name is chosen by the agent and not verified. `request.client.id` is the address of its metadata document, so its origin is who publishes the agent: show it, with `request.returns`, the host the user goes back to, and what the agent can do. `auth.consent(c)` also sets headers that stop other sites from framing the page.

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

Some agents publish no document and ask for a client ID when a user adds your app. Host a document for one yourself, and give its address as the client ID. A file your app serves, here at `https://example.com/clients/agent.json`:

```json
{
	"client_id": "https://example.com/clients/agent.json",
	"client_name": "Agent",
	"redirect_uris": ["https://agent.example/oauth/callback"],
	"token_endpoint_auth_method": "none"
}
```

Take the callback address from the agent's own documentation, never from a request: whoever receives a user there gets their token. The client ID is then on your own origin, so "Published by" would name your app, as if it were the one asking. Show `request.returns`, the agent's own host, in its place when `new URL(request.client.id).origin` is your origin.

Anyone can send a client ID, so downloads are limited: each IP can make 30 authorization requests per minute and download 10 documents per minute from one host, a host serves at most 300 downloads per minute in all, and an instance downloads at most 16 documents at once, 2 for one IP. Requests for the same agent share one download, a found agent is kept for 5 minutes, and a client ID without a valid document is remembered for a minute. When a download is refused, or fails in a way that may pass, such as a timeout or a 5xx response, an agent found in the last hour is served from its last document, so floods of made-up client IDs or a short outage cannot lock out agents users already connect. A final answer, such as a 404 or an invalid document, forgets the agent at once. Errors in an authorization request are answered with a 400 page, not redirected to the agent, since anyone can publish a document naming any callback.

Agents send the `resource` they will use the token with, the URL of an MCP endpoint mounted with this `auth`, when they authorize and when they request tokens; any other URL is refused, even on your origin. Authorization requires PKCE with S256. Codes last a minute and are used once, and access tokens last an hour. Refresh tokens are replaced each time they are used, but a connection ends 30 days after the user approved it, however often the agent refreshes; then the user connects it again. Using a code or refresh token a second time revokes every token issued from it, since one of the two parties stole it. A token grants what the user can do, so requests with a `scope` are refused. Tokens are bound to the resource they were requested for, such as the MCP endpoint, and stored as SHA-256 hashes.

In a tool call, `c.session()` returns the session of the user who approved the agent, so the same handlers serve people and agents.

`auth.agents(c)` lists the agents the signed-in user has connected, for an account page. Disconnect one with `auth.disconnect(c, id)`:

```tsx
const agents = await auth.agents(c);

<ul>
	{agents.map((agent) => (
		<li>
			{agent.name}, connected {new Date(agent.connected).toLocaleDateString()}
			<disconnect.Form>
				<input type="hidden" name="client" value={agent.id} />
				<button>Disconnect</button>
			</disconnect.Form>
		</li>
	))}
</ul>;

// in the route the form posts to
await auth.disconnect(c, result.data.client);
```

| Property    | What it is                                                                         |
| ----------- | ---------------------------------------------------------------------------------- |
| `id`        | The agent's client ID, which `disconnect` takes                                    |
| `name`      | The name it gave itself when the user approved it, not verified                    |
| `connected` | When the user approved it, in milliseconds                                         |
| `expires`   | When the connection ends and the user connects it again, 30 days after `connected` |

An agent is listed once it has taken its tokens, and once however often it refreshes them. An agent the user approved twice is listed by its latest approval. Both throw when nobody is signed in.

Once it resolves, that agent's codes and tokens no longer work, including ones a refresh was issuing at the same moment, and connecting again needs the user's consent. Disconnect through Auth, not by deleting rows from `auth_tokens` yourself: a delete can miss tokens a refresh commits while it runs. `auth.disconnect` acts for the signed-in user.

Logging out does not disconnect agents. Token requests are limited to 60 per minute per client IP.

## Deployment

Use HTTPS and browsers with native WebAuthn JSON support. JavaScript is required. Passkey forms load an external same-origin module; nonce-based content security policies can pass `auth.forms(c, { nonce })`.

Every instance must use the same database and signing secrets. Set up network overload protection at your edge.

Auth operations enforce the configured origin: on another host, `c.session()` returns `null`, signing in or out and preparing forms throw, and Auth's endpoints answer 421. Generated POST routes also require a same-origin `Sec-Fetch-Site` or matching `Origin`, even with `App` CSRF protection disabled. Cookies are host-wide, so use one authentication system per hostname. This implementation registers an account with a discoverable ES256/P-256 passkey, adds more with [`add.Form`](#add-a-passkey), and signs a user in once with a [sign-in link](#sign-in-link) you make for them. There is no self-service recovery, such as by email.
