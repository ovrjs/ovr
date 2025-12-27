import { createLayout } from "@/ui/layout";
import { Route } from "ovr";

/**
 * Minimal in-memory user list (demo only).
 * In a real app, store password hashes (we’ll do that next).
 */
const users = [
	{ id: "1", email: "ross@example.com", password: "password123" },
] as const;

export const auth = Route.get("/demo/auth", (c) => {
	const error = c.url.searchParams.get("error");
	const Layout = createLayout(c);

	return (
		<Layout head={""}>
			<h1>Login</h1>

			{error === "1" && <p>Invalid email or password</p>}

			<login.Form class="mb-8 grid max-w-sm gap-4">
				<div>
					<label for="email">Email</label>
					<input id="email" name="email" type="email" required />
				</div>
				<div>
					<label for="password">Password</label>
					<input id="password" name="password" type="password" required />
				</div>
				<button>Log in</button>
			</login.Form>

			<admin.Anchor>Admin</admin.Anchor>
		</Layout>
	);
});

export const login = Route.post(async (c) => {
	const data = await c.form().data();

	const email = data.get("email")?.toString() ?? "";
	const password = data.get("password")?.toString() ?? "";

	const user = users.find((u) => u.email === email && u.password === password);

	if (!user) {
		c.redirect(auth.url({ search: { error: "1" } }), 303);
		return;
	}

	await c.auth.login({ id: user.id });

	c.redirect(admin.url(), 303);
});

export const logout = Route.post((c) => {
	c.auth.logout();
	c.redirect(auth.url(), 303);
});

export const admin = Route.get("/admin", async (c) => {
	const session = await c.auth.require();
	const Layout = createLayout(c);

	return (
		<Layout head={""}>
			{() => {
				if (!session) {
					return (
						<>
							<h1>Unauthorized</h1>
							<auth.Anchor>Login</auth.Anchor>
						</>
					);
				}

				return (
					<>
						<h1>Admin</h1>
						<p>Hello, {users.find((user) => session.id === user.id)?.email}</p>

						<logout.Form>
							<div>
								<button>Logout</button>
							</div>
						</logout.Form>
					</>
				);
			}}
		</Layout>
	);
});
