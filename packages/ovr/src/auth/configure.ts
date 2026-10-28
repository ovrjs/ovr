import type { Context } from "../context/index.js";
import { jsx } from "../jsx/index.js";
import type { Middleware } from "../middleware/index.js";
import { Route } from "../route/index.js";
import { Field, Form } from "../schema/index.js";
import { Size } from "../util/index.js";
import type { Auth } from "./index.js";
import { Passkey } from "./passkey.js";

/** Complete passkey configuration. Callbacks may use any database or ORM. */
export interface Configuration<Shape extends Form.Shape> extends Auth.Options {
	readonly credentials: Auth.Credentials;
	readonly register: {
		/** Application fields, validated before prompting and again before saving. */
		readonly fields: Shape;
		/** Human-readable account label, independent of the opaque user handle. */
		readonly name: (data: Form.Parse.Data<Shape>) => Auth.Result<string>;
		/** Atomically insert a new user and credential, enforcing unique user and credential IDs. Never upsert an existing user. */
		readonly create: (
			data: Form.Parse.Data<Shape>,
			credential: Auth.Credential,
		) => Auth.Result<void>;
	};
	/** Authentication page, also used for generic failure redirects. Defaults to /auth. */
	readonly page?: string;
	/** Destination after registration or login. Defaults to /. */
	readonly redirect?: string;
	/** Override the default endpoint paths. Paths must be distinct literal local paths. */
	readonly paths?: Partial<
		Record<"register" | "login" | "logout" | "options" | "client", string>
	>;
	/** Required deployment admission policy for registration/login. Use a trusted edge or shared limiter; logout bypasses it. */
	readonly allow: (
		c: Pick<Context, "req" | "url" | "cookie">,
	) => Auth.Result<boolean>;
	/** Receive detailed failures for server-side logging. Details are never sent to the browser. */
	readonly error?: (
		error: unknown,
		c: Pick<Context, "req" | "url" | "cookie">,
	) => Auth.Result<void>;
}

/** Construct startup-complete handlers and request-scoped UI components. */
export function configure<Shape extends Form.Shape>(
	options: Configuration<Shape>,
): Auth.Passkeys<Shape> {
	if (typeof options.allow !== "function")
		throw new TypeError(
			"Auth.passkey requires an allow callback backed by your deployment admission policy",
		);
	const paths = {
		register: "/auth/register",
		login: "/auth/login",
		logout: "/auth/logout",
		options: "/_ovr/passkey/options",
		client: "/_ovr/passkey/client.js",
		...options.paths,
	};
	const page = options.page ?? "/auth";
	const redirect = options.redirect ?? "/";
	for (const path of [...Object.values(paths), page, redirect]) {
		if (
			!path.startsWith("/") ||
			path.startsWith("//") ||
			/[\\?#:*\s]/.test(path) ||
			new URL(path, options.origin).pathname !== path
		)
			throw new TypeError(
				"Auth paths must be literal local paths without queries or trailing slashes",
			);
		if (path.length > 1 && path.endsWith("/"))
			throw new TypeError("Auth paths cannot have trailing slashes");
	}
	const endpoints = [
		paths.register,
		paths.login,
		paths.logout,
		paths.client,
		`${paths.options}/register`,
		`${paths.options}/login`,
	];
	if (new Set(endpoints).size !== endpoints.length || endpoints.includes(page))
		throw new TypeError(
			"Auth endpoint paths must be distinct from each other and the page",
		);
	const fields = new Form(options.register.fields);
	if (
		fields.names.some((name) =>
			["credential", "ceremony", "bootstrap"].includes(name),
		)
	)
		throw new TypeError(
			"Passkey forms reserve credential, ceremony, and bootstrap fields",
		);

	const values = (data: unknown) => {
		if (!data || typeof data !== "object")
			throw new TypeError("Invalid parsed form");
		// Both routes validate this application shape before selecting its transformed values.
		return Object.fromEntries(
			fields.names.map((name) => [name, Reflect.get(data, name)]),
		) as Form.Parse.Data<Shape>;
	};

	const guard =
		(method: "register" | "login" | "logout", prompt = false) =>
		async (
			c: Pick<Context, "req" | "url" | "cookie" | "res" | "text" | "redirect">,
			next: Middleware.Next,
		) => {
			c.res.headers.set("cache-control", "no-store");
			try {
				if (c.url.origin !== options.origin)
					return c.text("Authentication failed.", 400);
				// Network identity comes from the deployment, never an unauthenticated cookie or guessed proxy header.
				if (method !== "logout" && !(await options.allow(c))) {
					c.res.headers.set("retry-after", "60");
					return c.text(
						"Too many authentication requests. Try again later.",
						429,
					);
				}
				await next();
			} catch (error) {
				if (options.error) {
					try {
						await options.error(error, c);
					} catch (failure) {
						console.error(failure);
					}
				} else console.error(error);
				if (method === "logout") c.text("Could not log out. Try again.", 503);
				else if (prompt) c.text("Authentication failed. Try again.", 400);
				else {
					const target = new URL(page, options.origin);
					target.searchParams.set("_auth", method);
					c.redirect(target, 303);
				}
			}
		};
	const register = Passkey.prepare(
		Route.post(
			paths.register,
			options.register.fields,
			guard("register"),
			async (c) => {
				const input = await c.data({ payload: 128 * Size.kb });
				if (!input || input.issues) throw input;
				const credential = await c.auth.passkey.register.verify();
				// Pass only application fields, never protocol fields, into the persistence callback.
				await options.register.create(values(input.data), credential);
				await c.auth.login(credential.user);
				c.redirect(redirect, 303);
			},
		),
	);
	const login = Passkey.prepare(
		Route.post(paths.login, {}, guard("login"), async (c) => {
			// Parse with a bounded body even on the schema-free protocol route.
			await c.data({ payload: 128 * Size.kb });
			const credential = await c.auth.passkey.login.verify(options.credentials);
			await c.auth.login(credential.user);
			c.redirect(redirect, 303);
		}),
	);
	const logout = Route.post(paths.logout, guard("logout"), async (c) => {
		await c.auth.logout();
		c.redirect(page, 303);
	});
	const registration = Route.post(
		`${paths.options}/register`,
		{ ...options.register.fields, bootstrap: Field.hidden() },
		guard("register", true),
		async (c) => {
			const input = await c.data({ payload: 128 * Size.kb });
			if (!input) throw new TypeError("Missing registration schema");
			if (input.issues) {
				const invalid = fields.names.filter((name) =>
					input.issues.some((issue) => issue.path[0] === name),
				);
				if (!invalid.length) throw input;
				c.json({ fields: invalid }, 422);
				return;
			}
			// The reserved bootstrap field is added to the validated application shape above.
			const data = input.data as Form.Parse.Data<Shape> & { bootstrap: string };
			await Passkey.issue(
				c,
				data.bootstrap,
				async () => ({ name: await options.register.name(values(data)) }),
				{ method: "register", action: paths.register },
			);
		},
	);
	const assertion = Route.post(
		`${paths.options}/login`,
		{ bootstrap: Field.hidden() },
		guard("login", true),
		async (c) => {
			const input = await c.data({ payload: 128 * Size.kb });
			if (!input || input.issues) throw input;
			await Passkey.issue(c, input.data.bootstrap, undefined, {
				method: "login",
				action: paths.login,
			});
		},
	);
	const client = Route.get(paths.client, ...Passkey.client.middleware);

	return {
		...options,
		routes: [register, login, logout, registration, assertion, client],
		/** Create forms in the handler before returning JSX, so ovr can set the binding cookie. */
		forms(c: Pick<Context, "auth" | "url">, props: { nonce?: string } = {}) {
			const Register = c.auth.passkey.register.form(register, {
				...props,
				endpoint: registration.pathname(),
				client: paths.client,
			});
			const Login = c.auth.passkey.login.form(login, {
				...props,
				endpoint: assertion.pathname(),
				client: paths.client,
			});
			const failure = c.url.searchParams.get("_auth");
			const error =
				(
					method: string,
					component: typeof Register.Error,
				): typeof Register.Error =>
				(props) =>
					component({
						...props,
						children:
							props.children ??
							(failure === method
								? "Authentication failed. Try again."
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
				Logout: (
					props: Parameters<typeof logout.Form>[0],
				): import("../jsx/index.js").JSX.Element =>
					jsx(logout.Form, {
						...props,
						children: props.children ?? jsx("button", { children: "Log out" }),
					}),
			};
		},
	};
}
