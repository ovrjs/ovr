---
title: Authentication
description: Build passkey register/login flows with `Context.auth`.
---

Use `Context.auth.passkey` to build a complete passkey flow with typed routes and form helpers.

- `create()` renders a registration form.
- `get()` renders a login form.
- `verify()` validates and returns a credential to store.
- `assert()` validates a login against a stored credential.
- `App` mounts `Passkey.options` automatically when `auth` is configured.

```ts
// auth.ts
import type { Auth, JSX, Middleware } from "ovr";
import { Route, Schema } from "ovr";
import * as route from "./index";

export type User = { id: string; email: string };
export const users = new Map<string, User>();
export const credentials = new Map<string, Auth.Credential>();

const UserForm = Schema.form({
	email: Schema.Field.email({ label: "Email" }),
});

export const guard = (
	handler: (
		c: Middleware.Context,
		auth: { session: Middleware.Context.Auth.Session; user: User },
	) => JSX.Element,
): Middleware => {
	return async (c) => {
		const session = await c.auth.session();
		if (!session) return c.redirect(route.page, 303);

		const user = users.get(session.id);
		if (!user) {
			c.auth.logout();
			return c.redirect(route.page, 303);
		}

		return handler(c, { session, user });
	};
};

export const register = Route.post(UserForm, async (c) => {
	const result = await c.data();
	if (result.issues) return c.redirect(result.url, 303);

	const credential = await c.auth.passkey.verify();
	users.set(credential.user, { id: credential.user, email: result.data.email });
	credentials.set(credential.id, credential);

	await c.auth.login(credential.user);
	c.redirect(route.admin, 303);
});

export const login = Route.post(async (c) => {
	const credential = await c.auth.passkey.assert((id) => credentials.get(id));
	const user = users.get(credential.user);

	if (!user) {
		c.auth.logout();
		return c.redirect(route.page, 303);
	}

	await c.auth.login(user.id);
	c.redirect(route.admin, 303);
});

export const logout = Route.post((c) => {
	c.auth.logout();
	c.redirect(route.page, 303);
});
```

```tsx
// index.tsx
import * as auth from "./auth";
import { Route } from "ovr";

export const page = Route.get("/demo/auth", (c) => {
	const Register = c.auth.passkey.create(auth.register);
	const Login = c.auth.passkey.get(auth.login);

	return (
		<>
			<Register />
			<hr />
			<Login />
		</>
	);
});

export const admin = Route.get("/demo/auth/admin", auth.guard((_c, state) => {
		return (
			<>
				<p>Signed in as {state.user.email}</p>
				<auth.logout.Form>
					<button>Logout</button>
				</auth.logout.Form>
			</>
		);
	}),
);
```
