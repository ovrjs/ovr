import type { Store } from "./store";
import * as content from "@/server/demo/auth/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Auth, Field, type JSX, type Middleware, Render, Route } from "ovr";

/** Application callbacks can call any existing database or ORM. SQLite belongs only to this demo. */
export function configure(
	store: Store,
	secret: string,
	origin = "https://localhost:5173",
) {
	return Auth.passkey({
		secret,
		origin,
		name: "ovr demo",
		page: "/demo/auth",
		redirect: "/demo/auth/admin",
		challenges: store.challenges,
		sessions: store.sessions,
		credentials: store.credentials,
		register: {
			fields: { email: Field.email({ label: "Email" }) },
			name: (data) => data.email,
			create: (data, credential) => store.register(credential, data.email),
		},
	});
}

/** Build the demo UI; ovr supplies the protocol and session handlers. */
export function routes(
	store: Store,
	authentication: ReturnType<typeof configure>,
) {
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

	/** Landing page for register/login passkey flows. */
	const auth = Route.get("/demo/auth", async (c) => {
		const Layout = createLayout(c);
		const session = await c.auth.session();
		const user = session ? store.user(session.id) : null;

		const { Register, Login } = authentication.forms(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				<h1>{content.frontmatter.title}</h1>

				{Render.html(content.html)}

				<div class="mt-24 flex justify-center">
					<div>
						<Register>
							<Register.Field name="email" />
							<Register.Error class="text-red-700" />
							<button>Create account</button>
						</Register>

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

	/** Protected dashboard route for demo session/credential output. */
	const admin = Route.get(
		"/demo/auth/admin",
		guard((c, auth) => {
			const userCredentials = store.list(auth.user.id);
			const { Logout } = authentication.forms(c);

			const Layout = createLayout(c);

			return (
				<Layout head={<Meta {...content.frontmatter} />}>
					<h1>Admin</h1>

					<p>Hello, {auth.user.email}</p>

					<h2>Session</h2>
					<pre>
						<code>
							{JSON.stringify(
								{ id: auth.session.id, expiration: auth.session.expiration },
								null,
								4,
							)}
						</code>
					</pre>

					<h2>Registered credentials</h2>
					<ul>
						{userCredentials.map((v) => (
							<li key={v.id}>{v.id}</li>
						))}
					</ul>

					<Logout>
						<button>Logout</button>
					</Logout>
				</Layout>
			);
		}),
	);

	return { auth, admin };
}
