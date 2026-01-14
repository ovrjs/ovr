import { users } from "@/server/+app";
import * as content from "@/server/demo/auth/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { type JSX, type Middleware, Render, Route } from "ovr";

/** Stored credential data */
type StoredCredential = { id: string; publicKey: string };

/** Get all credentials for a user */
const getUserCredentials = (userId: string): StoredCredential[] => {
	const user = users.values().find((u) => u.id === userId);
	return user?.credentials ?? [];
};

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

/** Landing page - registration + sign in options */
export const auth = Route.get("/demo/auth", async (c) => {
	const Layout = createLayout(c);

	// Generate passkey forms for both registration and login
	const userId = crypto.randomUUID();
	const Register = c.auth.passkey.create({
		id: userId,
		name: `user-${userId}`,
		displayName: "Passkey",
	});
	const Login = c.auth.passkey.get();

	return (
		<Layout head={<Meta {...content.frontmatter} />}>
			<h1>{content.frontmatter.title}</h1>

			{Render.html(content.html)}

			<div class="mb-4 flex gap-2">
				<Register>
					<button>Create passkey</button>
				</Register>

				<Login>
					<button class="secondary">Sign in</button>
				</Login>
			</div>

			<admin.Anchor>Admin</admin.Anchor>
		</Layout>
	);
});

/** Logout - clear session */
export const logout = Route.post((c) => {
	c.auth.logout();
	c.redirect(auth.url(), 303);
});

/** Admin page - show user ID and credentials */
export const admin = Route.get(
	"/admin",
	withAuth(async (c, session) => {
		const credentials = getUserCredentials(session.userId);
		const Layout = createLayout(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				{() => {
					return (
						<>
							<h1>Admin</h1>
							<p>User ID: {session.userId}</p>

							{credentials.length > 0 && (
								<>
									<h2>Registered credentials</h2>
									<ul>
										{credentials.map((cred) => (
											<li key={cred.id}>{cred.id}</li>
										))}
									</ul>
								</>
							)}

							<form>
								<logout.Button>Logout</logout.Button>
							</form>
						</>
					);
				}}
			</Layout>
		);
	}),
);
