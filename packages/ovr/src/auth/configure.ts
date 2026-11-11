import type { Context } from "../context/index.js";
import { Database } from "../database/index.js";
import { Field, Form, field } from "../form/index.js";
import { jsx } from "../jsx/index.js";
import { Limiter } from "../limiter/index.js";
import type { Middleware } from "../middleware/index.js";
import { Route } from "../route/index.js";
import { Header, Time, noStore } from "../util/index.js";
import type { Auth } from "./index.js";
import { Issue } from "./issue.js";
import { Passkey } from "./passkey.js";
import type { State } from "./state.js";
import type { Storage } from "./storage.js";

/**
 * Construct startup-complete handlers and request-scoped UI components.
 *
 * @template U Users table
 */
export function configure<U extends Auth.Users>(
	options: Auth.Options<U>,
	storage: Storage,
	state: (c: State.Context) => State,
) {
	type Shape = Form.Shape;
	const { users } = options;
	const defaults = (users.options.default ?? []) as readonly string[];
	/**
	 * The table's form fields, other than `id` and columns with defaults,
	 * which the server sets, such as a role
	 */
	const shape = Object.fromEntries(
		Object.entries(users.shape).filter(
			([name, schema]) =>
				name !== "id" && field(schema) && !defaults.includes(name),
		),
	) as Shape;
	/** @returns A limit of a method's requests, shared by every instance through the database */
	const limiter = (method: string, limit: number, interval: number) =>
		new Limiter(`auth:${method}:${options.origin}`, {
			limit,
			interval,
			database: options.database,
		});
	// fixed, they protect Auth's own storage: accounts and outstanding challenges
	const limits = {
		register: limiter("register", 5, 10 * Time.minute),
		login: limiter("login", 20, Time.minute),
	};
	const paths = {
		register: "/auth/register",
		login: "/auth/login",
		logout: "/auth/logout",
		options: "/_passkey/options",
	};
	const page = options.page ?? "/login";
	const redirect = options.redirect ?? "/";
	// Auth's own paths are fixed, only these come from options
	for (const path of [page, redirect, options.consent ?? "/connect"]) {
		if (
			!path.startsWith("/") ||
			path.startsWith("//") ||
			/[\\?#:*\s]/.test(path) ||
			(path.length > 1 && path.endsWith("/")) ||
			new URL(path, options.origin).pathname !== path
		)
			throw new TypeError(
				"Auth paths must be literal local paths without queries or trailing slashes",
			);
	}
	const fields = new Form(shape);

	/** @returns The first field, such as an email, or the host, naming the passkey */
	const name = (data: Form.Parse.Data<Shape>) => {
		const value = fields.names[0] && Reflect.get(data, fields.names[0]);
		return (
			typeof value === "string" && value.trim()
				? value.trim()
				: new URL(options.origin).hostname
		).slice(0, 256);
	};

	const values = (data: object) => {
		// Both routes validate this application shape before selecting its transformed values.
		return Object.fromEntries(
			fields.names.map((name) => [name, Reflect.get(data, name)]),
		) as Form.Parse.Data<Shape>;
	};

	const back = (c: Pick<Context, "redirect">, method: string, retry = 0) => {
		const target = new URL(page, options.origin);
		target.searchParams.set("_auth", method);
		if (retry) target.searchParams.set("_retry", String(retry));
		c.redirect(target, 303);
	};

	const admit = async (
		c: Limiter.Context & Pick<Context, "text" | "redirect">,
		method: "register" | "login",
		prompt: boolean,
	) => {
		const admission = await limits[method].check(
			c,
			prompt ? "options" : "verify",
		);
		if (admission === true) return true;
		const now = Date.now();
		const retry = Math.min(
			now + 3600000,
			Math.max(now + 1000, admission.getTime()),
		);
		if (!prompt) {
			back(c, method, retry);
			return false;
		}
		Issue.limited(c, Math.ceil((retry - now) / 1000));
		return false;
	};
	/** Sign the user in, and send them where they were going */
	const enter = async (
		c: State.Context & Pick<Context, "redirect">,
		user: string,
	) => {
		await state(c).login(user);
		c.redirect(state(c).resume(redirect), 303);
	};
	const guard =
		(method: "register" | "login" | "logout", prompt = false) =>
		async (
			c: Limiter.Context & Pick<Context, "text" | "redirect">,
			next: Middleware.Next,
		) => {
			noStore(c.res.headers);
			try {
				if (c.url.origin !== options.origin)
					return c.text("Authentication failed.", 400);
				if (
					c.req.headers.get(Header.name.fetch) !== "same-origin" &&
					c.req.headers.get(Header.name.origin) !== options.origin
				) {
					if (method === "logout" || prompt)
						return c.text("Authentication failed.", 403);
					return back(c, method);
				}
				// Network identity comes from the deployment, never an unauthenticated cookie or guessed proxy header.
				if (
					method !== "logout" &&
					!(prompt && method === "register") &&
					!(await admit(c, method, prompt))
				)
					return;
				await next();
			} catch (error) {
				// a failure the client caused is answered, anything else reaches the app
				if (!(error instanceof Issue)) throw error;
				if (prompt) c.text("Authentication failed. Try again.", 400);
				else back(c, method);
			}
		};
	const register = Passkey.prepare(
		Route.post(paths.register)
			.fields(shape)
			.use(guard("register"), async (c) => {
				// the users table's fields, only known at runtime
				const input = (await Issue.data(c)) as Form.Parse.Result<Shape> | null;
				if (!input || input.issues) throw new Issue("registration fields");
				const data = values(input.data);
				const credential = await new Passkey(c, state(c)).register(
					await Passkey.fields(data),
				);
				// only the table's fields, never protocol fields
				await storage
					.register(async (t, user) => {
						await t.sql`INSERT INTO ${users} ${t.sql.values(users, { ...data, id: user } as never)}`;
					}, credential)
					.catch((error: unknown) => {
						// an account or passkey that already exists
						if (Database.unique(error)) throw new Issue("account");
						throw error;
					});
				await enter(c, credential.user);
			}),
	);
	const login = Passkey.prepare(
		Route.post(paths.login)
			.fields({})
			.use(guard("login"), async (c) => {
				// Bound the body before verification.
				if (!(await Issue.data(c))) throw new Issue("login request");
				const credential = await new Passkey(c, state(c)).login(
					storage.credentials,
				);
				await enter(c, credential.user);
			}),
	);
	const logout = Route.post(paths.logout).use(guard("logout"), async (c) => {
		await state(c).logout();
		c.redirect(page, 303);
	});
	const registration = Route.post(`${paths.options}/register`)
		.fields({ ...shape, bootstrap: Field.hidden() })
		.use(guard("register", true), async (c) => {
			const input = await Issue.data(c);
			if (!input) throw new Issue("registration request");
			if (input.issues) {
				const invalid = fields.names.filter((name) =>
					input.issues.some((issue) => issue.path[0] === name),
				);
				if (!invalid.length) throw new Issue("registration request");
				return c.json({ fields: invalid }, 422);
			}
			if (!(await admit(c, "register", true))) return;
			// The reserved bootstrap field is added to the validated application shape above.
			const data = input.data as Form.Parse.Data<Shape> & { bootstrap: string };
			const application = values(data);
			await Passkey.issue(c, state(c), data.bootstrap, {
				method: "register",
				action: paths.register,
				name: name(application),
				fields: await Passkey.fields(application),
			});
		});
	const assertion = Route.post(`${paths.options}/login`)
		.fields({ bootstrap: Field.hidden() })
		.use(guard("login", true), async (c) => {
			const input = await Issue.data(c);
			if (!input || input.issues) throw new Issue("login request");
			await Passkey.issue(c, state(c), input.data.bootstrap, {
				method: "login",
				action: paths.login,
			});
		});
	const routes = [
		register,
		login,
		logout,
		registration,
		assertion,
		Passkey.client,
	];
	if (routes.some((route) => route.pattern === page))
		throw new TypeError("Auth's page cannot be one of its endpoints");
	return {
		routes,
		/** Create forms in the handler before returning JSX, so ovr can set the binding cookie. */
		forms(
			c: Auth.Context,
			props: { nonce?: string } = {},
		): Auth.Forms<Auth.Fields<U>> {
			const passkey = new Passkey(c, state(c));
			const Register = passkey.form(register, "register", {
				...props,
				endpoint: registration.url(),
			});
			const Login = passkey.form(login, "login", {
				...props,
				endpoint: assertion.url(),
			});
			const failure = c.url.searchParams.get("_auth");
			const retry = Number(c.url.searchParams.get("_retry"));
			const wait =
				Number.isSafeInteger(retry) && retry > 0
					? Math.min(3600, Math.max(0, Math.ceil((retry - Date.now()) / 1000)))
					: undefined;
			const error =
				(method: string, component: typeof Register.Error) =>
				(props: Parameters<typeof Register.Error>[0]) =>
					component({
						...props,
						children:
							props.children ??
							(failure === method
								? wait !== undefined
									? `Too many authentication requests. ${wait ? `Try again in ${wait} seconds.` : "Try again now."}${method === "register" ? " If you already registered, sign in." : ""}`
									: method === "register"
										? "Registration could not be completed. If you already registered, sign in; otherwise try again."
										: "Authentication failed. Try again."
								: undefined),
					});
			Register.Error = error("register", Register.Error);
			Login.Error = error("login", Login.Error);
			return {
				Register: Object.assign(Register, {
					Field: fields.Field,
					Fields: fields.Fields,
				}),
				Login,
				Logout: (props: Parameters<typeof logout.Form>[0]) =>
					jsx(logout.Form, {
						...props,
						children: props.children ?? jsx("button", { children: "Log out" }),
					}),
			};
		},
	};
}
