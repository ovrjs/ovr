import type { Context } from "../context/index.js";
import { jsx } from "../jsx/index.js";
import { LimitIssue, Limiter } from "../limiter/index.js";
import type { Middleware } from "../middleware/index.js";
import { Route } from "../route/index.js";
import { Field, Form } from "../schema/index.js";
import { Size } from "../util/index.js";
import type { Auth } from "./index.js";
import { Passkey } from "./passkey.js";
import type { State } from "./state.js";

/** Construct startup-complete handlers and request-scoped UI components. */
export function configure<Shape extends Form.Shape>(
	options: Auth.Options<Shape>,
	state: (c: State.Context) => State,
): {
	routes: readonly Route[];
	forms: (c: Auth.Context, props?: { nonce?: string }) => Auth.Forms<Shape>;
} {
	if (typeof options.limits?.consume !== "function")
		throw new TypeError(
			"Auth requires shared rate-limit storage in limits.consume",
		);
	if (
		options.limits.guard !== undefined &&
		!(options.limits.guard instanceof Limiter)
	)
		throw new TypeError("Auth limits.guard must be a Limiter");
	if (
		options.limits.extra !== undefined &&
		(!Array.isArray(options.limits.extra) ||
			[...options.limits.extra].some(
				(limiter) => !(limiter instanceof Limiter),
			))
	)
		throw new TypeError("Auth limits.extra must be an array of Limiters");
	// Snapshot stacks at startup so later array mutations cannot disable admission.
	const limits = Object.fromEntries(
		Object.entries({
			register:
				options.limits?.register ??
				new Limiter({
					name: "auth:register:" + options.origin,
					limit: 5,
					interval: 600000,
					consume: options.limits.consume,
				}),
			login:
				options.limits?.login ??
				new Limiter({
					name: "auth:login:" + options.origin,
					limit: 20,
					interval: 60000,
					consume: options.limits.consume,
				}),
		}).map(([method, value]) => {
			if (!(value instanceof Limiter))
				throw new TypeError(
					"Auth client policies must be a Limiter; use limits.extra for additional layers",
				);
			return [
				method,
				[
					...(options.limits.guard ? [options.limits.guard] : []),
					value,
					...(options.limits.extra ?? []),
				],
			];
		}),
	);
	const paths = {
		register: options.paths?.register ?? "/auth/register",
		login: options.paths?.login ?? "/auth/login",
		logout: options.paths?.logout ?? "/auth/logout",
		options: "/_ovr/passkey/options",
		client: "/_ovr/passkey/client.js",
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

	const back = (c: Pick<Context, "redirect">, method: string, retry = 0) => {
		const target = new URL(page, options.origin);
		target.searchParams.set("_auth", method);
		if (retry) target.searchParams.set("_retry", String(retry));
		c.redirect(target, 303);
	};

	const guard =
		(method: "register" | "login" | "logout", prompt = false) =>
		async (
			c: Pick<
				Context,
				"req" | "url" | "cookie" | "res" | "text" | "redirect" | "ip"
			>,
			next: Middleware.Next,
		) => {
			c.res.headers.set("cache-control", "no-store");
			try {
				if (c.url.origin !== options.origin)
					return c.text("Authentication failed.", 400);
				// Network identity comes from the deployment, never an unauthenticated cookie or guessed proxy header.
				if (method !== "logout") {
					for (const limiter of limits[method]!) {
						const admission = await limiter
							.check(c, prompt ? "options" : "verify")
							.catch((cause: unknown) => {
								throw new LimitIssue("Authentication rate limit unavailable", {
									cause,
								});
							});
						if (admission !== true) {
							if (!(admission instanceof Date))
								throw new TypeError("Invalid auth admission result");
							const now = Date.now();
							const deadline = admission.getTime();
							if (!Number.isSafeInteger(deadline))
								throw new TypeError("Invalid auth retry deadline");
							const retry = Math.min(
								now + 3600000,
								Math.max(now + 1000, deadline),
							);
							if (!prompt) return back(c, method, retry);
							c.res.headers.set(
								"retry-after",
								String(Math.ceil((retry - now) / 1000)),
							);
							return c.text(
								"Too many authentication requests. Try again later.",
								429,
							);
						}
					}
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
				else if (prompt)
					c.text(
						"Authentication failed. Try again.",
						error instanceof LimitIssue ? 503 : 400,
					);
				else back(c, method);
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
				const credential = await new Passkey(c, state(c)).register.verify();
				// Pass only application fields, never protocol fields, into the persistence callback.
				await options.register.create(values(input.data), credential);
				await state(c).login(credential.user);
				c.redirect(redirect, 303);
			},
		),
	);
	const login = Passkey.prepare(
		Route.post(paths.login, {}, guard("login"), async (c) => {
			// Parse with a bounded body even on the schema-free protocol route.
			await c.data({ payload: 128 * Size.kb });
			const credential = await new Passkey(c, state(c)).login.verify(
				options.credentials,
			);
			await state(c).login(credential.user);
			c.redirect(redirect, 303);
		}),
	);
	const logout = Route.post(paths.logout, guard("logout"), async (c) => {
		await state(c).logout();
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
				state(c),
				data.bootstrap,
				() => options.register.name(values(data)),
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
			await Passkey.issue(c, state(c), input.data.bootstrap, undefined, {
				method: "login",
				action: paths.login,
			});
		},
	);
	const client = Passkey.client;

	return {
		routes: [register, login, logout, registration, assertion, client],
		/** Create forms in the handler before returning JSX, so ovr can set the binding cookie. */
		forms(c: Auth.Context, props: { nonce?: string } = {}) {
			const passkey = new Passkey(c, state(c));
			const Register = passkey.register.form(register, {
				...props,
				endpoint: registration.pathname(),
			});
			const Login = passkey.login.form(login, {
				...props,
				endpoint: assertion.pathname(),
			});
			const failure = c.url.searchParams.get("_auth");
			const retry = Number(c.url.searchParams.get("_retry"));
			const wait =
				Number.isSafeInteger(retry) && retry > 0
					? Math.min(3600, Math.max(0, Math.ceil((retry - Date.now()) / 1000)))
					: undefined;
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
