import { type Store, users } from "./store";
import * as content from "@/server/demo/auth/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Auth, Markup, Route } from "ovr";

/** Auth stores its data in the demo database; the application creates accounts. */
export function configure(
	database: Store,
	secret: string,
	origin = "https://localhost:5173",
) {
	return new Auth({
		secret,
		origin,
		database,
		page: "/demo/auth",
		redirect: "/demo/auth/admin",
		users,
	});
}

/**
 * @param database Demo database
 * @param id User ID
 * @returns The account, if it exists
 */
async function account(database: Store, id: string) {
	const [user] = await database.sql`
		SELECT * FROM ${database.users} WHERE ${database.users.columns.id} = ${id}
	`.parse(database.users);

	return user;
}

/** Build the demo UI; ovr supplies the protocol and session handlers. */
export function routes(database: Store, service: ReturnType<typeof configure>) {
	/** Landing page for register/login passkey flows. */
	const auth = Route.get("/demo/auth").use(async (c) => {
		const Layout = createLayout(c);
		const session = await c.session();
		const user = session ? await account(database, session.user) : null;

		const { Register, Login } = service.forms(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				<h1>{content.frontmatter.title}</h1>

				{Markup.raw(content.html)}

				<div class="mt-8 flex justify-center">
					<div>
						<h2>Log in</h2>
						<Login />

						<hr />

						<h2>Create account</h2>
						<Register>
							<Register.Field name="email" />
							<Register.Error class="text-red-700" />
							<button>Create account</button>
						</Register>

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
	const admin = Route.get("/demo/auth/admin").use(async (c) => {
		const session = await c.session();
		if (!session) return c.redirect(auth, 303);
		const user = await account(database, session.user);
		if (!user) {
			await service.logout(c);
			return c.redirect(auth, 303);
		}
		const { Logout } = service.forms(c);
		const Layout = createLayout(c);
		const credentials = await database.sql`
			SELECT * FROM ${database.auth_credentials}
			WHERE ${database.auth_credentials.columns.user} = ${user.id} ORDER BY id
		`.parse(database.auth_credentials);

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
					{credentials.map((v) => (
						<li key={v.id}>{v.id}</li>
					))}
				</ul>

				<Logout>
					<button>Log out</button>
				</Logout>
			</Layout>
		);
	});

	return { auth, admin };
}
