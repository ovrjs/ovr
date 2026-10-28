import type { Store } from "./store";
import * as content from "@/server/demo/auth/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Field, Form, type JSX, type Middleware, Render, Route } from "ovr";

/** Build demo routes using one persistent authentication database. */
export function routes(store: Store) {
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

			const user = store.user(session.id);

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
	const auth = Route.get("/demo/auth", async (c) => {
		const Layout = createLayout(c);
		const session = await c.auth.session();
		const user = session ? store.user(session.id) : null;

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
	const logout = Route.post(async (c) => {
		await c.auth.logout();
		c.redirect(auth, 303);
	});

	/** Protected dashboard route for demo session/credential output. */
	const admin = Route.get(
		"/demo/auth/admin",
		guard((c, auth) => {
			const userCredentials = store.list(auth.user.id);

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

	const register = Route.post(User, async (c) => {
		const result = await c.data();

		if (result.issues) return c.redirect(result.url, 303);

		const credential = await c.auth.passkey.register.verify();

		try {
			store.register(credential, result.data.email);
		} catch (error) {
			if (
				error instanceof Error &&
				"errcode" in error &&
				typeof error.errcode === "number" &&
				error.errcode % 256 === 19
			) {
				return c.text("This account or passkey is already registered.", 409);
			}
			throw error;
		}

		await c.auth.login(credential.user);

		c.redirect(admin, 303);
	});

	const login = Route.post(async (c) => {
		const credential = await c.auth.passkey.login.verify(store.credentials);
		const user = store.user(credential.user);

		if (!user) {
			await c.auth.logout();
			c.redirect(auth, 303);
			return;
		}

		await c.auth.login(user.id);

		c.redirect(admin, 303);
	});

	return { auth, admin, register, login, logout };
}
