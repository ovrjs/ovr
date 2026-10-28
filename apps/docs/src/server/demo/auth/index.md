---
title: Authentication
description: Passkey forms, built-in handlers, and persistence callbacks for any database.
---

`new Auth(...)` supplies registration, username-free login, logout, verification, and revocable sessions. Your application supplies typed callbacks using its own database or ORM. ovr adds no database driver, ORM integration, or runtime dependency. The current implementation supports discoverable **ES256 / P-256** passkeys with required user verification and `none` attestation.

```tsx
import { App, Auth, Field, Route } from "ovr";

const auth = new Auth({
	secret, // At least 32 random bytes; keep it stable across restarts.
	origin: "https://example.com",
	name: "My app",
	page: "/auth",
	redirect: "/account",
	limits: { consume: consumeToken }, // Atomic shared database operation.

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

Auth automatically applies independent token buckets to registration and login before body parsing or challenge storage. The defaults allow a burst of **5 registrations**, replenished at **5 per 10 minutes**, and **20 sign-ins**, replenished at **20 per minute**, per trusted client IP (IPv6 is grouped by `/64`, with mapped IPv4 addresses using their IPv4 budget). Options and verification have separate budgets, so the two requests in a normal ceremony do not spend the same budget twice. Logout bypasses these policies, including storage failures. The required `limits.consume` callback connects shared storage; ovr chooses the policy values, so no numeric configuration is required.

Supply the trusted client IP once in your server entry point. A standard Fetch `Request` does not contain its socket peer. For a direct Deno HTTPS listener:

```ts
Deno.serve({ cert, key }, (request, info) =>
	app.fetch(request, { ip: info.remoteAddr.hostname }),
);
```

Here `cert` and `key` are your TLS PEM strings. `app.fetch(request, { ip })` preserves the original request while exposing the trusted IP as `c.ip`. Do not copy an arbitrary `X-Forwarded-For` header into this option. Behind a reverse proxy the socket peer identifies that proxy: accept connections only from your proxy and configure it to overwrite the client identity before using its verified header. Missing or invalid peer metadata fails closed with HTTP 503 on auth options requests, and a generic failure redirect on final submits. Session reads and logout do not require an IP. [Deno HTTP server API](https://docs.deno.com/api/deno/http-server/).

For a Cloudflare Worker exposed through its Internet-facing edge, with Worker-to-Worker subrequests blocked by your edge policy:

```ts
export default {
	fetch(request: Request) {
		const ip = request.headers.get("CF-Connecting-IP");
		return app.fetch(request, ip ? { ip } : {});
	},
};
```

That trust comes from Cloudflare's edge and routing policy. Same-zone Worker subrequests can reflect a caller-modified `x-real-ip`; cross-zone subrequests use a fixed address. If those callers are allowed, provide an authenticated identity policy instead. Cloudflare documents a rule using `cf.worker.upstream_zone` to block Worker subrequests. [Cloudflare request headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/), [blocking Worker subrequests](https://developers.cloudflare.com/waf/custom-rules/use-cases/block-worker-subrequests/).

IPv6 `/64` grouping prevents a separate budget for each rotating interface identifier. It does not contain an attacker who controls a larger allocation: a `/56` contains 256 separate `/64` networks and a `/48` contains 65,536. Just 50 login bursts can fill the demo's 1,000 outstanding challenges when attackers use fresh browser bindings. The defaults alone therefore do not protect shared challenge capacity against prefix sweeping. Broader and aggregate policies can limit this traffic, but they also combine legitimate users into shared budgets. IPv6 allocation sizes vary; neither `/64` nor `/48` is a universal client boundary. [IPv6 temporary addresses (RFC 8981)](https://www.rfc-editor.org/rfc/rfc8981.html), [IPv6 end-site assignments (RFC 6177)](https://www.rfc-editor.org/rfc/rfc6177).

Rate-limit counters always live in application-supplied shared storage. There is no in-memory fallback or process-local counter cache. Every request consults the backend, and missing storage is rejected at startup. Configure the same shared atomic operation for all workers while retaining the built-in policy values:

```ts
const auth = new Auth({ ...configuration, limits: { consume: consumeToken } });
```

`consumeToken(key, { limit, interval })` must atomically replenish and consume one token, returning literal boolean `true` on admission or a positive absolute retry time in milliseconds on denial. Numeric `1` denies; fractional deadlines round up. All workers must share storage and policy values; errors must throw. Stable keys include the namespace, numeric policy, request phase, and normalized client identity. The built-in auth namespaces include the origin and operation. Different policies cannot corrupt each other's token balances; identical policies using the same name and scope intentionally share a quota. The SQLite demo implements this operation in a transaction across connections to the same database file. That file must be persistent and shared; serverless deployments need a database reachable by every function instance. Cleanup and storage capacity belong to the shared backend. Advanced overrides can supply `limits.register` or `limits.login` as one `Limiter` or a non-empty array checked in order. [Reusable rate-limit middleware](/05-middleware#rate-limiting) can also protect ordinary routes.

For example, this deployment-specific stack adds a global ceiling and a broader IPv6 budget while retaining the original per-client policies:

```ts
import { Auth, Limiter } from "ovr";

const global = new Limiter({
	name: `auth:global:${configuration.origin}`,
	limit: 100,
	interval: 60000,
	key: () => "all",
	consume: consumeToken,
});
const network = new Limiter({
	name: `auth:network:${configuration.origin}`,
	limit: 40,
	interval: 60000,
	prefix: 48,
	consume: consumeToken,
});
const auth = new Auth({
	...configuration,
	limits: {
		consume: consumeToken,
		register: [
			global,
			network,
			new Limiter({
				name: `auth:register:${configuration.origin}`,
				limit: 5,
				interval: 600000,
				consume: consumeToken,
			}),
		],
		login: [
			global,
			network,
			new Limiter({
				name: `auth:login:${configuration.origin}`,
				limit: 20,
				interval: 60000,
				consume: consumeToken,
			}),
		],
	},
});
```

These aggregate numbers are examples, not additional defaults. Set them against your traffic and challenge storage capacity, accounting for the initial burst plus refill during the full ceremony lifetime. Using the same global and network instances for both operations shares their options budget across signup and sign-in, while verification has its own budget. All layers must admit; the first denial or error stops processing before body parsing or challenge writes. Earlier layers keep their consumed tokens if a later layer denies, so put cheap aggregate ceilings first to bound per-client record creation. Stacks are copied and validated at startup; logout skips them all. Global ceilings limit resource usage but can themselves be exhausted to deny legitimate traffic, so edge protections remain necessary.

The persistence functions above are application code. The transaction shown uses the normal Drizzle API; ovr neither imports Drizzle nor chooses a database package for you. Registration fields determine the callback's data type and the available `Register.Field` names. `Register.Fields` renders all application fields. Omitting a form's children supplies fields, a button, and an accessible error status automatically. Plain HTML, field component customization, and normal form attributes remain available.

Call `auth.forms(c)` **inside the handler before returning JSX** so the secure browser binding cookie reaches the response. ovr prepares complete POST schemas when configuring the service; submitting to another instance does not require that instance to have rendered the form.

Call `auth.session(c)` and await session reads in route handlers or middleware before returning streamed JSX, then pass the resolved data to components. A first auth access inside an async component runs during streaming, when response status and headers may already be committed. A wrong origin still prevents auth access, but the resulting stream error cannot reliably become an HTTP 421 response; cookies and redirects must also be set before streaming starts.

For a protected page:

```tsx
app.use(
	Route.get("/account", async (c) => {
		const session = await auth.session(c);
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

Load your user record using `session.id`. Email syntax validation does **not** verify ownership of an email address. Registration creates a new opaque UUID user handle; the account label returned by `register.name` is only for display in the passkey provider. Provider labels reflect the options-time fields; final registration fields are validated again and may differ if edited during the prompt. Labels are display data, not proof of a verified identity. This signup API does not attach passkeys to existing users. An account-management flow must separately authorize its current user before adding or removing credentials.

Keep registration field schemas limited to format and other non-secret validation. Do not query account existence or uniqueness from a field schema: the HTTP 422 field names would reveal which values exist. Enforce uniqueness inside the transactional `register.create` callback and with database constraints, where failures receive the same generic registration message.

Persistence callbacks may be synchronous or asynchronous. All instances must share the same persistence and signing secret:

| Callback                             | Required behavior                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `challenges.set(id, value)`          | Store until `value.expiration`; evict expired records. May return `false` to refuse a write when capacity is exhausted.                                                     |
| `challenges.take(id)`                | **Atomically return and delete** the record; concurrent callers must have exactly one winner.                                                                               |
| `sessions.set(token, value)`         | Persist the new session before ovr issues its cookie.                                                                                                                       |
| `sessions.get(token)`                | Return the session or nothing if expired/revoked. ovr also checks expiration.                                                                                               |
| `sessions.delete(token)`             | Revoke the session; failures must throw.                                                                                                                                    |
| `credentials.find(id)`               | Return the stored passkey or nothing.                                                                                                                                       |
| `credentials.update(next, previous)` | Atomically compare the stored record against `previous`, save `next`, and return whether one record matched, including a no-op update. Never recreate a deleted credential. |
| `register.create(data, credential)`  | Create the account and first passkey together in a transaction. Enforce unique user and credential IDs; insert a new user, never upsert an existing one. Throw on failure.  |

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

User creation and its first credential must commit together, but session creation is a later operation. If `sessions.set` fails after `register.create` commits, the account and passkey remain saved and no new session cookie is issued. The user can recover with the normal login form. All registration failures include the same guidance to sign in if already registered, without revealing whether an account was saved. Do not upsert the user or attach more credentials when replaying signup to recover from this condition.

`credentials.update` returns a **matched-snapshot result**, not a changed-row count. It must return true when the stored record matches `previous`, even if the counter and backup state remain unchanged. MySQL normally reports changed rows unless matched-row reporting is enabled. Use your driver's matched-row mode, `RETURNING` where supported, or an atomic transaction that returns the match result. Do not interpret zero changed rows as success without checking the snapshot atomically. No separate `exists` callback is needed. [MySQL affected-row semantics](https://dev.mysql.com/doc/refman/8.4/en/information-functions.html).

Use database columns matching the exported types. Separate challenge reads and deletes are unsafe. A credential update must compare the owner, key, counter, and backup flags, even when a credential always reports a zero counter. Enforce user/credential/session relationships in the database. Schedule cleanup of expired state, and cap outstanding challenges in shared storage when serving public traffic; the SQLite demo shows a bounded atomic insert.

Default paths are `POST /auth/register`, `/auth/login`, `/auth/logout`, and `/_ovr/passkey/options/register` and `/login`, plus `GET /_ovr/passkey/client.js`. Override them together or individually with `paths: { register, login, logout, options, client }`; `options` is the base pathname for both options endpoints. `page` defaults to `/auth` and the success `redirect` defaults to `/`. Paths must be distinct literal local paths. Invalid application fields return HTTP 422 with field names and controlled browser validation messages; arbitrary schema messages and authentication details are not reflected to the browser. Other authentication failures return a generic status for options requests or redirect back to `page` with a generic form error. Admission denials on the final POST return HTTP 303 to `page` with `_auth` and `_retry` display state; this avoids stranding users on a bare error page after the browser prompt. These query parameters only affect the message, never admission. HTTP 429 responses include `Retry-After`; the client accepts seconds or an HTTP date and suppresses early retries. A failed logout returns HTTP 503 and leaves its session cookie intact. Supply `error(error, c)` for detailed server logging; the default uses `console.error`.

The browser runtime is a regular external JavaScript module. Policies allowing same-origin scripts work without inline JavaScript; nonce-based policies can use `auth.forms(c, { nonce })`. It handles streamed forms, cancellation, native validation, submitters, older browser option conversion, and newer native WebAuthn JSON parsers. A successful native submission stays locked while navigation is pending; a canceled or invalid final submission unlocks for retry. If navigation never completes, a recovery timer unlocks the form and clears stale protocol fields after the configured prompt timeout plus one minute (two minutes by default, capped at five minutes). It does not automatically retry or extend the server's ceremony lifetime. Forms restored from the back/forward cache reset their locks, timers, and stale ceremony fields. The browser module uses ETag revalidation, so an unchanged asset returns HTTP 304. JavaScript and HTTPS are required.

Session lifetime defaults to seven days (`duration` in milliseconds) without sliding refresh. `await auth.logout(c)` revokes the current session; `await auth.revoke(c, token)` revokes another selected session. Account-wide revocation can delete sessions by user ID in your own database. Each request reads shared session storage, so revocation applies across instances without a stale session cache. Authentication responses use `Cache-Control: no-store`.

The browser prompt defaults to 60 seconds (`timeout` in milliseconds); the server accepts the ceremony for that timeout **plus one minute** to allow response verification. Options are fetched on submit, and each ceremony is browser-, operation-, pathname-, and origin-bound and atomically consumed on the first verification attempt. Signed form bootstrap tokens expire after an hour. `credential`, `ceremony`, and `bootstrap` are reserved field names.

Rate limits and storage capacity serve different purposes. Automatic per-client policies protect registration/login traffic before body parsing and writes. Apply network overload protection at your deployment edge too. Authentication form bodies are limited to 128 KiB. The shared backend must bound its storage and reclaim expired buckets. Shared counters do not make distributed attacks harmless. Distributed clients or clients controlling multiple IPv6 prefixes can still saturate shared challenge capacity, even with shared limiter storage. The SQLite example's capacity caps bound storage but are not sufficient abuse protection. Challenges remain database-backed; signed ceremony tokens with a replay ledger are a separate possible design change.

Generated auth endpoints reject a request whose origin differs from the configured HTTPS origin with HTTP 421, before rate limiting or protocol handling. `auth.session(c)`, `auth.forms(c)`, and the session mutation methods enforce this origin too. Unrelated health checks and canonical-host redirects can serve alternate hostnames normally. ovr does not infer trust from forwarded headers.

`new Auth(configuration)` creates the service, and `new App({ auth })` mounts its generated routes. All request helpers belong to that instance: `auth.forms(c)`, `auth.session(c)`, `auth.login(c, user)`, `auth.logout(c)`, and `auth.revoke(c, token)`. Registration and login handlers establish sessions automatically; direct `login` is for an application-authorized user whose ID is non-blank and at most 1,024 UTF-8 bytes. Request-local caches are isolated by service and context. Cookies are host-wide, so use one authentication system per hostname; separate instances are intended to serve different requests or workers with the same configuration, not independent sign-in systems on one host. The protocol implementation is internal. The earlier `Auth.passkey()` factory and `c.auth` helpers have been removed.

The runnable demo uses Node 24's built-in SQLite driver in application code, with no additional package. The demo is enabled only in development and uses a fixed loopback identity in that local entry point. Public server adapters must supply the real trusted client IP. Its rate-limit buckets are shared through SQLite using the built-in policy values. Enable it in development using `AUTH_SECRET`, `AUTH_ORIGIN` (default `https://localhost:5173`), and optional `AUTH_DATABASE` (default `.auth.sqlite`). Serve through HTTPS. Its database persists across restarts, is excluded from Git, and holds users, credentials, challenges, and sessions. Cleanup runs on startup and at most once per minute during writes, including expired rate-limit buckets.

The demo refuses new rate-limit keys at 10,000 live rows while continuing to enforce existing buckets. This is deliberate fail-closed behavior, not production availability protection: an attacker filling those rows denies admission to new identities until records expire. Do not replace it with eviction of depleted live buckets, because recreating one restores its full burst and enables quota bypass. A production backend needs capacity sized for its retention and admitted key-creation rate, expired or provably fully replenished bucket reclamation, aggregate admission ahead of high-cardinality keys, and capacity monitoring. An exhausted backend must still deny rather than grant fresh budgets. Behind a proxy, passing its address as the client identity also makes the entire site share one quota; verify the trusted identity integration before serving public traffic. The library cannot detect that misconfiguration at startup from a Fetch Request.
