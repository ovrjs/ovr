import { credentials, users } from "./store";
import * as content from "@/server/demo/auth/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Field, Form, type JSX, type Middleware, Render, Route } from "ovr";

/** Auth utility that loads both session and user for protected routes. */
const guard = (
	handler: (
		c: Middleware.Context,
		auth: {
			session: Middleware.Context.Auth.Session;
			user: { id: string; email: string };
		},
	) => JSX.Element,
): Middleware => {
	return async (c) => {
		const session = await c.auth.session();

		if (!session) {
			c.redirect(auth, 303);
			return;
		}

		const user = users.get(session.id);

		if (!user) {
			await c.auth.logout();
			c.redirect(auth, 303);
			return;
		}

		return handler(c, { session, user });
	};
};

const User = new Form({ email: Field.email({ label: "Email" }) });

/** Landing page for register/login passkey flows. */
export const auth = Route.get("/demo/auth", async (c) => {
	const Layout = createLayout(c);
	const session = await c.auth.session();
	const user = session ? users.get(session.id) : null;

	const Register = c.auth.passkey.register.form(register);
	const Login = c.auth.passkey.login.form(login);

	return (
		<Layout head={<Meta {...content.frontmatter} />}>
			<h1>{content.frontmatter.title}</h1>

			{Render.html(content.html)}

			<div class="mt-24 flex justify-center">
				<div>
					<Register />

					<hr />

					<Login />

					{user && (
						<>
							<p>Signed in as {user.email}</p>
							<p>
								<admin.Anchor>Go to dashboard</admin.Anchor>
							</p>
						</>
					)}
				</div>
			</div>
		</Layout>
	);
});

/** Logout handler clears the auth session cookie. */
export const logout = Route.post(async (c) => {
	await c.auth.logout();
	c.redirect(auth, 303);
});

/** Protected dashboard route for demo session/credential output. */
export const admin = Route.get(
	"/demo/auth/admin",
	guard((c, auth) => {
		const userCredentials = Array.from(credentials.values()).filter(
			(v) => v.user === auth.user.id,
		);

		const Layout = createLayout(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				<h1>Admin</h1>

				<p>Hello, {auth.user.email}</p>

				<h2>Session</h2>
				<pre>
					<code>{JSON.stringify(auth.session, null, 4)}</code>
				</pre>

				<h2>Registered credentials</h2>
				<ul>
					{userCredentials.map((v) => (
						<li key={v.id}>{v.id}</li>
					))}
				</ul>

				<logout.Form>
					<button>Logout</button>
				</logout.Form>
			</Layout>
		);
	}),
);

export const register = Route.post(User, async (c) => {
	const result = await c.data();

	if (result.issues) return c.redirect(result.url, 303);

	const credential = await c.auth.passkey.register.verify();

	if (credentials.has(credential.id)) {
		return c.text("This passkey is already registered.", 409);
	}

	const user = users.get(credential.user) ?? {
		email: result.data.email,
		id: credential.user,
	};

	users.set(user.id, user);
	credentials.set(credential.id, credential);

	await c.auth.login(user.id);

	c.redirect(admin, 303);
});

export const login = Route.post(async (c) => {
	const credential = await c.auth.passkey.login.verify({
		find: (id) => credentials.get(id),
		update(credential, previous) {
			if (credentials.get(credential.id) !== previous) return false;
			credentials.set(credential.id, credential);
			return true;
		},
	});
	const user = users.get(credential.user);

	if (!user) {
		await c.auth.logout();
		c.redirect(auth, 303);
		return;
	}

	await c.auth.login(user.id);

	c.redirect(admin, 303);
});
