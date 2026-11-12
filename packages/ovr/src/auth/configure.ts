import type { Context } from "../context/index.js";
import { Database } from "../database/index.js";
import { Field, Form, field, taken } from "../form/index.js";
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
import { Token } from "./token.js";

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
	type Shape = Field.Shape;
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
		add: limiter("add", 5, 10 * Time.minute),
	};
	const paths = {
		register: "/auth/register",
		login: "/auth/login",
		logout: "/auth/logout",
		passkey: "/auth/passkey",
		link: "/auth/link",
		options: "/_passkey/options",
	} as const;
	const page = options.page ?? "/login";
	const redirect = options.redirect ?? "/";
	const fields = new Form(shape);

	/** @returns The first field, such as an email, or the host, naming the passkey */
	const name = (data: Field.Parse.Data<Shape>) => {
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
		) as Field.Parse.Data<Shape>;
	};

	/**
	 * @param data Registration values
	 * @returns The message of each `taken()` field whose value a user has
	 */
	const conflicts = async (data: Field.Parse.Data<Shape>) => {
		const used: Record<string, string> = {};
		for (const name of fields.names) {
			const message = shape[name]![taken];
			const value: unknown = Reflect.get(data, name);
			if (message === undefined || value == null || value === "") continue;
			const rows = await options.database
				.sql`SELECT 1 FROM ${users} WHERE ${users.columns[name]!} = ${value} LIMIT 1`;
			if (rows.length) used[name] = message;
		}
		return used;
	};

	/** @returns The page a form was on, if it said, or where a login goes */
	const returning = (c: Pick<Context, "url">) => {
		const target = new URL(
			c.url.searchParams.get(Form.params[0]) ?? redirect,
			options.origin,
		);
		return target.origin === options.origin
			? target
			: new URL(redirect, options.origin);
	};

	const back = (
		c: Pick<Context, "redirect" | "url">,
		method: string,
		retry = 0,
	) => {
		// a passkey is added from a page of the account, not the login page
		const target =
			method === "add" ? returning(c) : new URL(page, options.origin);
		target.searchParams.set("_auth", method);
		if (retry) target.searchParams.set("_retry", String(retry));
		c.redirect(target, 303);
	};

	const admit = async (
		c: Limiter.Context & Pick<Context, "text" | "redirect" | "url">,
		method: "register" | "login" | "add" | "link",
		prompt: boolean,
	) => {
		// a link signs in, so it shares a login's limit
		const admission = await limits[method === "link" ? "login" : method].check(
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
		(
			method: "register" | "login" | "logout" | "add" | "link",
			prompt = false,
		) =>
		async (
			c: Limiter.Context & Pick<Context, "text" | "redirect" | "url">,
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
	const register = Route.post(paths.register)
		.fields({ ...shape, ...Passkey.shape })
		.use(guard("register"), async (c) => {
			// the users table's fields, only known at runtime
			const input = (await Issue.data(c)) as Field.Parse.Result<Shape> | null;
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
		});
	const login = Route.post(paths.login)
		.fields(Passkey.shape)
		.use(guard("login"), async (c) => {
			// Bound the body before verification.
			if (!(await Issue.data(c))) throw new Issue("login request");
			const credential = await new Passkey(c, state(c)).login(
				storage.credentials,
			);
			await enter(c, credential.user);
		});
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
				// each field's own message: checks of what the person typed,
				// which say nothing about other accounts
				const invalid: Record<string, string> = {};
				for (const name of fields.names) {
					const issue = input.issues.find((issue) => issue.path[0] === name);
					if (issue) invalid[name] = issue.message;
				}
				if (!Object.keys(invalid).length)
					throw new Issue("registration request");
				return c.json({ fields: invalid }, 422);
			}
			if (!(await admit(c, "register", true))) return;
			// The reserved bootstrap field is added to the validated application shape above.
			const data = input.data as Field.Parse.Data<Shape> & {
				bootstrap: string;
			};
			const application = values(data);
			// a public value already used, such as a username, is said before
			// the passkey prompt, so no passkey is saved for a failed account
			const used = await conflicts(application);
			if (Object.keys(used).length) return c.json({ fields: used }, 422);
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
	/** What a person calls a passkey they add, such as "Laptop" */
	const naming = {
		name: Field.text()
			.max(64)
			.optional()
			.label("Name")
			.hint("Such as the device it is on"),
	};
	const add = Route.post(paths.passkey)
		.fields({ ...naming, ...Passkey.shape })
		.use(guard("add"), async (c) => {
			const input = await Issue.data(c);
			if (!input || input.issues) throw new Issue("passkey request");
			const session = await state(c).session();
			if (!session) throw new Issue("session");
			const credential = await new Passkey(c, state(c)).register();
			// the account that started the ceremony is still the one signed in
			if (credential.user !== session.user) throw new Issue("user");
			await storage
				.register(() => {}, {
					...credential,
					name: input.data.name?.trim() || null,
				})
				.catch((error: unknown) => {
					// a passkey that is already an account's
					if (Database.unique(error)) throw new Issue("passkey");
					throw error;
				});
			c.redirect(returning(c), 303);
		});
	const adding = Route.post(`${paths.options}/add`)
		// the form's own field is sent with it, and saved when it submits
		.fields({ ...naming, bootstrap: Field.hidden() })
		.use(guard("add", true), async (c) => {
			const input = await Issue.data(c);
			if (!input || input.issues) throw new Issue("passkey request");
			const session = await state(c).session();
			if (!session) return c.text("Sign in to add a passkey.", 401);
			const [account] = await options.database
				.sql`SELECT * FROM ${users} WHERE ${users.columns.id!} = ${session.user}`;
			await Passkey.issue(c, state(c), input.data.bootstrap, {
				method: "register",
				action: paths.passkey,
				name: name((account ?? {}) as Field.Parse.Data<Shape>),
				user: session.user,
				exclude: await storage.credentials.list(session.user),
			});
		});
	/** The parameter of the authentication page a link's token is in */
	const linked = "_link";
	const link = Route.post(paths.link)
		.fields({ link: Field.hidden() })
		.use(guard("link"), async (c) => {
			const input = await Issue.data(c);
			if (!input || input.issues) throw new Issue("link request");
			// once, and only at the origin it was made for
			const user = await storage.links.take(input.data.link, options.origin);
			if (!user) throw new Issue("link");
			await enter(c, user);
		});
	const routes = [
		register,
		login,
		logout,
		add,
		link,
		registration,
		assertion,
		adding,
		Passkey.client,
	];
	return {
		routes,
		/** Make a link that signs a user in once, see `Auth.link`. */
		async link(
			user: string,
			{
				origin = options.origin,
				minutes = 10,
			}: { origin?: string; minutes?: number } = {},
		) {
			const target = new URL(page, origin);
			if (target.protocol !== "https:" || target.origin !== origin)
				throw new TypeError("A link's origin must be an HTTPS origin");
			if (!(minutes > 0 && minutes <= 60))
				throw new TypeError("A link lasts at most 60 minutes");

			const token = Token.random();
			await storage.links.set(token, {
				user,
				origin,
				expiration: Date.now() + minutes * Time.minute,
			});
			target.searchParams.set(linked, token);
			return target.href;
		},
		/** Create forms in the handler before returning JSX, so ovr can set the binding cookie. */
		forms(
			c: Auth.Context,
			props: { nonce?: string } = {},
		): Auth.Forms<Auth.Fields<U>> {
			const passkey = new Passkey(c, state(c));
			// the page that sent the user here, such as /login?_return=/recipes/1,
			// is where they go after logging in
			const back = c.url.searchParams.get(Form.params[0]);
			if (back) state(c).remember(back);
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
				(method: string, component: typeof Register.Issue) =>
				(props: Parameters<typeof Register.Issue>[0]) =>
					component({
						...props,
						children:
							props.children ??
							(failure === method
								? wait !== undefined
									? `Too many authentication requests. ${wait ? `Try again in ${wait} seconds.` : "Try again now."}${method === "register" ? " If you already registered, sign in." : ""}`
									: method === "register"
										? "Registration could not be completed. If you already registered, sign in; otherwise try again."
										: method === "add"
											? "The passkey could not be added. Try again."
											: method === "link"
												? "This link has expired or was already used."
												: "Authentication failed. Try again."
								: undefined),
					});
			// another passkey for the account signed in, such as on a new device
			const Add = passkey.form(add, "register", {
				...props,
				endpoint: adding.url(),
				submit: "Add passkey",
			});
			Register.Issue = error("register", Register.Issue);
			Login.Issue = error("login", Login.Issue);
			Add.Issue = error("add", Add.Issue);
			// a link's token, from the address the link opened
			const token = c.url.searchParams.get(linked);
			const Link = Object.assign(
				(props: Parameters<typeof link.Form>[0]) =>
					(token || failure === "link") &&
					jsx(link.Form, {
						...props,
						children: [
							token && [
								jsx("input", { type: "hidden", name: "link", value: token }),
								props.children ?? jsx("button", { children: "Sign in" }),
							],
							Link.Issue({}),
						],
					}),
				{
					Issue: error("link", (props: Parameters<typeof Add.Issue>[0]) =>
						jsx("p", { role: "status", "aria-live": "polite", ...props }),
					),
				},
			);
			return {
				Register: Object.assign(Register, {
					Field: fields.Field,
					Fields: fields.Fields,
				}),
				Login,
				Add,
				Link,
				Logout: (props: Parameters<typeof logout.Form>[0]) =>
					jsx(logout.Form, {
						...props,
						children: props.children ?? jsx("button", { children: "Log out" }),
					}),
			};
		},
	};
}
