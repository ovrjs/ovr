import * as content from "@/server/demo/auth/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import {
	type Auth,
	type JSX,
	type Middleware,
	Render,
	Route,
	Schema,
} from "ovr";

const users: { id: string; email: string }[] = [];
const credentials: Auth.Credential[] = [];

/** Middleware to protect routes - require authentication */
const withAuth = (
	handler: (
		c: Middleware.Context,
		session: Middleware.Context.Auth.Session,
	) => JSX.Element,
): Middleware => {
	return async (c) => {
		const session = await c.auth.session();

		if (session) return handler(c, session);

		c.res.status = 401;
		const Layout = createLayout(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				<h1>Unauthorized</h1>
				<auth.Anchor>Login</auth.Anchor>
			</Layout>
		);
	};
};

const User = Schema.form({ email: Schema.Field.email({ label: "Email" }) });

/** Landing page - registration + sign in options */
export const auth = Route.get("/demo/auth", (c) => {
	const Layout = createLayout(c);

	const Register = c.auth.passkey.create(register);
	const Login = c.auth.passkey.get(login);

	return (
		<Layout head={<Meta {...content.frontmatter} />}>
			<h1>{content.frontmatter.title}</h1>

			{Render.html(content.html)}

			<div class="mt-24 flex justify-center">
				<div class="border-secondary bg-muted grid max-w-3xs rounded-md border p-4">
					<Register class="grid gap-4">
						<User.Fields />
						<button class="secondary">Register</button>
					</Register>

					<hr class="my-4" />

					<Login class="grid" />
				</div>
			</div>
		</Layout>
	);
});

/** Logout - clear session */
export const logout = Route.post((c) => {
	c.auth.logout();
	c.redirect(auth, 303);
});

/** Admin page - show user ID and credentials */
export const admin = Route.get(
	"/admin",
	withAuth((c, session) => {
		const user = users.find((u) => u.id === session.id)!;
		const userCredentials = credentials.filter((c) => c.user === user.id);

		const Layout = createLayout(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				{() => {
					return (
						<>
							<h1>Admin</h1>

							<p>Hello, {user.email}</p>

							<h2>Session</h2>
							<pre>
								<code>{JSON.stringify(session, null, 4)}</code>
							</pre>

							<h2>Registered credentials</h2>
							<ul>
								{userCredentials.map((c) => (
									<li key={c.id}>{c.id}</li>
								))}
							</ul>

							<logout.Form>
								<button>Logout</button>
							</logout.Form>
						</>
					);
				}}
			</Layout>
		);
	}),
);

export const register = Route.post(async (c) => {
	const { email } = await c.form().parse(User);

	const credential = await c.auth.passkey.verify();
	credentials.push(credential);

	let user = users.find((u) => u.id === credential.user);

	if (!user) {
		user = { email, id: credential.user };
		users.push(user);
	}

	await c.auth.login(user.id);

	c.redirect(admin, 303);
});

export const login = Route.post(async (c) => {
	const credential = await c.auth.passkey.assert((id) =>
		credentials.find((c) => id === c.id),
	);

	await c.auth.login(credential.user);

	c.redirect(admin, 303);
});
