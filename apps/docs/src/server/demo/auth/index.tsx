import * as content from "@/server/demo/auth/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Crypto, JSX, type Middleware, Render, Route } from "ovr";
import { z } from "zod";

/** In-memory user list (demo only) */
const users: { id: string; email: string; passwordHash: string }[] = [];

const Credentials = z.object({
	email: z.email(),
	password: z.string().min(8, "Password must be at least 8 characters"),
});

const parseCredentials = async (c: Middleware.Context) => {
	const data = await c.form().data();

	return Credentials.safeParse({
		email: data.get("email"),
		password: data.get("password"),
	});
};

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

export const auth = Route.get("/demo/auth", async (c) => {
	const error = c.url.searchParams.get("error");
	const Layout = createLayout(c);

	const session = await c.auth.session();

	if (session) {
		c.redirect(admin.url(), 303);
		return;
	}

	return (
		<Layout head={<Meta {...content.frontmatter} />}>
			<h1>{content.frontmatter.title}</h1>

			{Render.html(content.html)}

			{error === "1" && <p>Invalid email or password</p>}
			{error === "2" && <p>Email already registered</p>}
			{error === "3" && <p>Invalid input</p>}

			<form class="mb-8 grid max-w-sm gap-4">
				<div>
					<label for="email">Email</label>
					<input id="email" name="email" type="email" required />
				</div>
				<div>
					<label for="password">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						minlength={8}
					/>
				</div>

				<div class="flex gap-2">
					<login.Button>Log in</login.Button>
					<signup.Button class="secondary">Sign up</signup.Button>
				</div>
			</form>

			<admin.Anchor>Admin</admin.Anchor>
		</Layout>
	);
});

export const login = Route.post(async (c) => {
	const result = await parseCredentials(c);

	if (!result.success) {
		c.redirect(auth.url({ search: { error: "3" } }), 303);
		return;
	}

	const { email, password } = result.data;
	const user = users.find((u) => u.email === email);

	if (!user) {
		c.redirect(auth.url({ search: { error: "1" } }), 303);
		return;
	}

	const valid = await Crypto.verify(password, user.passwordHash);

	if (!valid) {
		c.redirect(auth.url({ search: { error: "1" } }), 303);
		return;
	}

	await c.auth.login({ id: user.id });

	c.redirect(admin.url(), 303);
});

export const signup = Route.post(async (c) => {
	const result = await parseCredentials(c);

	if (!result.success) {
		c.redirect(auth.url({ search: { error: "3" } }), 303);
		return;
	}

	const { email, password } = result.data;
	const existing = users.find((u) => u.email === email);

	if (existing) {
		c.redirect(auth.url({ search: { error: "2" } }), 303);
		return;
	}

	const user = {
		id: crypto.randomUUID(),
		email,
		passwordHash: await Crypto.hash(password),
	};

	users.push(user);

	await c.auth.login({ id: user.id });

	c.redirect(admin.url(), 303);
});

export const logout = Route.post((c) => {
	c.auth.logout();
	c.redirect(auth.url(), 303);
});

export const admin = Route.get(
	"/admin",
	withAuth(async (c, session) => {
		const user = users.find((u) => session.id === u.id);
		const Layout = createLayout(c);

		return (
			<Layout head={<Meta {...content.frontmatter} />}>
				{() => {
					return (
						<>
							<h1>Admin</h1>
							<p>Hello, {user?.email ?? session.id}</p>

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
