---
"ovr": minor
---

Passkey authentication and rate limiting, stored in the app's Postgres database.

```tsx
const auth = new Auth({ secret, origin, database, users: database.users });

app.use(
	auth,
	Route.get("/login").use((c) => {
		const { register, login } = auth.forms(c);

		return (
			<>
				<login.Form />
				<register.Form />
			</>
		);
	}),
	Route.get("/account").use(
		auth.guard(async (c) => {
			const { user } = await c.session();
		}),
	),
);
```

- **Accounts:** accounts are rows of the app's own users table, and Auth's tables come from `Auth.tables`, whose migrations `database.migrate` applies. Registration fields are the users table's, and a `Field.taken(message)` field says when another user has its value.
- **Forms:** `auth.forms(c)` returns `register`, `login`, `add`, `link`, and `logout`, each a form as a route's is. `/login?_return=/path` brings the user back to a path of the app's own.
- **Sessions:** `c.session()` returns the session or `null`. `auth.guard(handler)` wraps a route that needs someone signed in, and redirects anyone else to the authentication page and back. Sessions are revocable and renew while used, up to their `lifetime`. A response to a browser that sends the session cookie is `Cache-Control: no-store`.
- **Passkeys:** `add.Form` adds another passkey to the account, after a sign-in within the last ten minutes. `auth.passkeys(c)` lists them and `auth.remove(c, id)` removes one, never the last, signs the user out everywhere else, and disconnects their agents.
- **Sign-in links:** `auth.link(user, { origin })` makes a link that signs a user in once, for five minutes, such as at an origin where they have no passkey.
- **Agents:** `auth.consent(c)` returns the request an agent made to connect, for the consent page. `auth.agents(c)` lists the user's agents and `auth.disconnect(c, id)` disconnects one. In a tool call `c.session()` is the approving user's, with `agent` set to the agent's `id` and `name`. Tokens are stored hashed, and a connection ends 30 days after approval.
- **`Limiter`:** rate limits your own routes, with buckets stored in `Limiter.table`. Its `key` can count each signed-in user. Sign-in has fixed limits of its own. An unavailable limiter throws instead of admitting the request.
