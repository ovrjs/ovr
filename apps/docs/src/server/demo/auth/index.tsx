import { type Store, users } from "./store";
import * as content from "@/server/demo/auth/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Auth, Field, Render, Route } from "ovr";

/** Auth stores its data in the demo database; the application creates accounts. */
export function configure(
	db: Store,
	secret: string,
	origin = "https://localhost:5173",
) {
	return new Auth({
		secret,
		origin,
		database: db,
		page: "/demo/auth",
		redirect: "/demo/auth/admin",
		register: {
			fields: { email: Field.email({ label: "Email" }) },
			name: (data) => data.email,
			create: async (t, data, user) => {
				await t.sql`INSERT INTO ${users} ${t.sql.values(users, { id: user, email: data.email })}`;
			},
		},
	});
}

/**
 * @param db Demo database
 * @param id User ID
 * @returns The account, if it exists
 */
async function account(db: Store, id: string) {
	const [user] = await db.sql`
		SELECT * FROM ${db.users} WHERE ${db.users.columns.id} = ${id}
	`.parse(db.users);

	return user;
}

/** Build the demo UI; ovr supplies the protocol and session handlers. */
export function routes(db: Store, service: ReturnType<typeof configure>) {
	/** Landing page for register/login passkey flows. */
	const auth = Route.get("/demo/auth").use(async (c) => {
		const Layout = createLayout(c);
		const session = await service.session(c);
		const user = session ? await account(db, session.user) : null;

		const { Register, Login } = service.forms(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				<h1>{content.frontmatter.title}</h1>

				{Render.html(content.html)}

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
		const session = await service.session(c);
		if (!session) return c.redirect(auth, 303);
		const user = await account(db, session.user);
		if (!user) {
			await service.logout(c);
			return c.redirect(auth, 303);
		}
		const { Logout } = service.forms(c);
		const Layout = createLayout(c);
		const credentials = await db.sql`
			SELECT * FROM ${db.auth_credentials}
			WHERE ${db.auth_credentials.columns.user} = ${user.id} ORDER BY id
		`.parse(db.auth_credentials);

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
