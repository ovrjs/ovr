import type { Store } from "./store";
import * as content from "@/server/demo/auth/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Auth, Field, Render, Route } from "ovr";

/** Application callbacks can call any existing database or ORM. SQLite belongs only to this demo. */
export function configure(
	store: Store,
	secret: string,
	origin = "https://localhost:5173",
) {
	return new Auth({
		secret,
		origin,
		page: "/demo/auth",
		redirect: "/demo/auth/admin",
		challenges: store.challenges,
		sessions: store.sessions,
		credentials: store.credentials,
		limits: { consume: store.consume },
		register: {
			fields: { email: Field.email({ label: "Email" }) },
			name: (data) => data.email,
			create: (data, credential) => store.register(credential, data.email),
		},
	});
}

/** Build the demo UI; ovr supplies the protocol and session handlers. */
export function routes(store: Store, service: ReturnType<typeof configure>) {
	/** Landing page for register/login passkey flows. */
	const auth = Route.get("/demo/auth", async (c) => {
		const Layout = createLayout(c);
		const session = await service.session(c);
		const user = session ? store.user(session.user) : null;

		const { Register, Login } = service.forms(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				<h1>{content.frontmatter.title}</h1>

				{Render.html(content.html)}

				<div class="mt-8 flex justify-center">
					<div>
						<h2>Register</h2>
						<Register>
							<Register.Field name="email" />
							<Register.Error class="text-red-700" />
							<button>Create account</button>
						</Register>

						<hr />

						<h2>Log in</h2>
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
	const admin = Route.get("/demo/auth/admin", async (c) => {
		const session = await service.session(c);
		if (!session) return c.redirect(auth, 303);
		const user = store.user(session.user);
		if (!user) {
			await service.logout(c);
			return c.redirect(auth, 303);
		}
		const { Logout } = service.forms(c);
		const Layout = createLayout(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				<h1>Admin</h1>

				<p>Hello, {user.email}</p>

				<h2>Session</h2>
				<pre>
					<code>
						{JSON.stringify(
							{ user: session.user, expiration: session.expiration },
							null,
							4,
						)}
					</code>
				</pre>

				<h2>Registered credentials</h2>
				<ul>
					{store.list(user.id).map((v) => (
						<li key={v.id}>{v.id}</li>
					))}
				</ul>

				<Logout>
					<button>Logout</button>
				</Logout>
			</Layout>
		);
	});

	return { auth, admin };
}
