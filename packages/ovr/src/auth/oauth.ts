import { crossOrigin, direct } from "../app/index.js";
import type { Context } from "../context/index.js";
import { Field } from "../form/index.js";
import { jsx } from "../jsx/index.js";
import { Limiter, network } from "../limiter/index.js";
import type { Middleware } from "../middleware/index.js";
import { Route } from "../route/index.js";
import { Codec, Header, Size, Time } from "../util/index.js";
import type { Auth } from "./index.js";
import { Issue } from "./issue.js";
import { Metadata } from "./metadata.js";
import { Passkey } from "./passkey.js";
import type { State } from "./state.js";
import { Storage } from "./storage.js";
import { Token } from "./token.js";

/** Authorization request waiting for the user's approval */
type Pending = {
	readonly client: string;
	readonly name: string;
	readonly redirect: string;
	/** The request named `redirect`, so the code exchange must name it too */
	readonly named: boolean;
	readonly challenge: string;
	readonly resource: string;
	readonly state: string | null;
	readonly user: string;
	readonly expiration: number;
};

/** Agent from its client ID metadata document */
type Client = {
	readonly id: string;
	readonly name: string;
	readonly redirects: readonly string[];
};

/** OAuth endpoint paths */
const paths = {
	metadata: "/.well-known/oauth-authorization-server",
	authorize: "/oauth/authorize",
	approve: "/oauth/approve",
	deny: "/oauth/deny",
	prompt: "/_passkey/options/approve",
	token: "/oauth/token",
} as const;

/** Lifetimes */
const lifetime = {
	consent: 10 * Time.minute,
	code: Time.minute,
	access: Time.hour,
	refresh: 30 * Time.day,
};

/** Largest request body */
const limit = 16 * 1024;

/** Client ID metadata document downloads */
const downloads = {
	/** Downloads at once, per instance */
	concurrent: 16,
	/** Downloads at once for one client IP, per instance */
	each: 2,
	/** How long a client ID without a document is remembered */
	missing: Time.minute,
	/** Agents kept after they are found, per instance */
	cached: 1000,
	/** How long a found agent is kept */
	lifetime: 5 * Time.minute,
	/**
	 * How long a found agent's document is used when a new download is
	 * refused or fails for now, short since its redirects could have changed
	 */
	stale: Time.hour,
};

/**
 * OAuth 2.1 authorization server for agents. The user signs in with a passkey
 * and approves the agent on the app's consent page; the agent receives tokens.
 *
 * @param options Auth options
 * @param storage Auth storage
 * @param state Request state
 * @returns Endpoints, the consent form, and bearer token verification
 */
export function oauth(
	options: Auth.Options<any>,
	storage: Storage,
	state: (c: State.Context) => State,
	resources: ReadonlySet<string>,
) {
	const { origin } = options;
	const page = options.page ?? "/login";
	const consent = options.consent ?? "/connect";

	const limiter = new Limiter(`auth:tokens:${origin}`, {
		limit: 60,
		interval: Time.minute,
		database: options.database,
	});

	/** Authorization requests, by IP, each can download a document */
	const authorizations = new Limiter(`auth:authorize:${origin}`, {
		limit: 30,
		interval: Time.minute,
		database: options.database,
	});

	/**
	 * Downloads from each document host by each client IP, so one client
	 * cannot spend a host's downloads for everyone
	 */
	const hosts = new Limiter(`auth:metadata:${origin}`, {
		limit: 10,
		interval: Time.minute,
		database: options.database,
	});

	/** Downloads from each document host in all, so the server cannot flood one */
	const ceiling = new Limiter(`auth:metadata-hosts:${origin}`, {
		limit: 300,
		interval: Time.minute,
		database: options.database,
		key: () => "hosts",
	});

	/** Agents found recently, by client ID */
	const found = new Map<
		string,
		{ client: Client; expiration: number; stale: number }
	>();

	/** Client IDs without a valid document, until when, by client ID */
	const missing = new Map<string, number>();

	/** Downloads in progress, by client ID */
	const pending = new Map<string, Promise<Client | null | undefined>>();

	/** Downloads in progress, by client IP, so one cannot take every slot */
	const active = new Map<string, number>();

	/**
	 * Finds an agent, downloading its document at most once at a time.
	 *
	 * @param c Request context
	 * @param id Client ID
	 * @returns The agent, `undefined` if it is unknown, or `null` if downloads are limited or failing for now
	 */
	const agent = async (c: Context, id: string | null) => {
		const url = id ? identify(id) : undefined;
		if (!id || !url) return;

		const now = Date.now();
		let known = found.get(id);
		if (known && known.expiration > now) return known.client;
		if (known && known.stale <= now) {
			found.delete(id);
			known = undefined;
		}
		if ((missing.get(id) ?? 0) > now) return;
		missing.delete(id);

		// a download refused or failing for now serves an agent found before
		// from its last document, so floods of other client IDs or a passing
		// outage cannot lock it out
		const refused = () => known?.client ?? null;

		let download = pending.get(id);
		if (!download) {
			// a client's network, so rotating IPv6 addresses do not add slots
			const ip = network(c.ip) ?? "";
			const slots = () =>
				pending.size < downloads.concurrent &&
				(active.get(ip) ?? 0) < downloads.each;
			if (!slots()) return refused();

			// each request's own share, before it starts a download others may
			// join, so one client's refusal is never another's
			if ((await hosts.check(c, url.host)) !== true) return refused();

			download = pending.get(id);
			if (!download) {
				if (!slots()) return refused();
				active.set(ip, (active.get(ip) ?? 0) + 1);

				download = (async () => {
					if ((await ceiling.check(c, url.host)) !== true) return null;

					const client = await find(id, url);
					// a failure that may pass keeps what is known, and is not remembered
					if (client === null) return null;

					// the oldest is forgotten first
					found.delete(id);
					if (client) {
						if (found.size >= downloads.cached)
							found.delete(found.keys().next().value!);
						const now = Date.now();
						found.set(id, {
							client,
							expiration: now + downloads.lifetime,
							stale: now + downloads.stale,
						});
					} else {
						if (missing.size >= downloads.cached)
							missing.delete(missing.keys().next().value!);
						missing.set(id, Date.now() + downloads.missing);
					}
					return client;
				})().finally(() => {
					pending.delete(id);
					const left = (active.get(ip) ?? 1) - 1;
					if (left) active.set(ip, left);
					else active.delete(ip);
				});

				pending.set(id, download);
			}
		}

		const client = await download;
		return client === null ? refused() : client;
	};

	const random = () =>
		Codec.Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)));

	/** Public endpoints that browser-based agents call from their own origin */
	const cors: Middleware = async (c, next) => {
		c.res.headers.set(Header.name.cache, "no-store");
		c.res.headers.set("access-control-allow-origin", "*");
		c.res.headers.set(
			"access-control-allow-headers",
			"authorization, content-type, mcp-protocol-version",
		);
		c.res.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
		if (c.req.method === "OPTIONS") {
			c.res.status = 204;
			return;
		}
		return next();
	};

	const admit = async (c: Context, limiter: Limiter) => {
		// an unavailable limiter throws to the app, it never skips the limit
		if ((await limiter.check(c)) === true) return true;
		c.json({ error: "temporarily_unavailable" }, 429);
		return false;
	};

	const fail = (
		c: Context,
		error: string,
		description?: string,
		status = 400,
	) =>
		c.json(
			{ error, ...(description ? { error_description: description } : {}) },
			status,
		);

	/** @returns Body parameters, bounded in size */
	const body = async (c: Context) => {
		const bytes = await Codec.read(c.req.body, limit);
		if (!bytes) return;
		try {
			return Codec.decode(bytes);
		} catch {
			return;
		}
	};

	const routes: Route[] = [];

	/**
	 * The endpoints an agent signs in through are, like the MCP endpoint, the
	 * way in and not pages of the app: they run without the app's global
	 * middleware, so a check for a session there cannot turn an agent away
	 * before it has signed in. Auth's own check of the host is global
	 * middleware too, so these routes make it themselves, first.
	 */
	const host: Middleware = (c, next) => {
		if (c.url.origin === origin) return next();
		c.res.headers.set(Header.name.cache, "no-store");
		return c.text("Misdirected Request", 421);
	};

	/**
	 * @param route Endpoint an agent or its user's browser requests to sign in
	 * @returns The route, outside the app's global middleware
	 */
	const outside = (route: Route) => {
		direct.add(route);
		routes.push(route);
		return route;
	};

	const cross = (route: Route) => {
		// browsers send the preflight cross-site too, without credentials
		const preflight = new Route("OPTIONS", route.pattern).use(host, cors);
		crossOrigin.add(route).add(preflight);
		outside(route);
		outside(preflight);
		return route;
	};

	/** @returns `true` for a request from the app's own pages */
	const same = (c: Pick<Context, "req">) =>
		c.req.headers.get(Header.name.fetch) === "same-origin" ||
		c.req.headers.get(Header.name.origin) === origin;

	/** @returns `true` for a passkey or form that could not be verified */
	const unverified = (error: unknown) =>
		error instanceof Issue ||
		(typeof error === "object" && error !== null && "issues" in error);

	/**
	 * @param c Request context
	 * @param request Sealed authorization request
	 * @returns The request, or `undefined` after responding when it expired or another user decides
	 */
	const asked = async (
		c: State.Context & Pick<Context, "text">,
		request: string | null,
	) => {
		const pending = await open(request);
		if (!pending)
			return void c.text("The request expired. Try connecting again.", 400);

		const session = await state(c).session();
		if (!session || session.user !== pending.user)
			return void c.text("Forbidden", 403);

		return pending;
	};

	/**
	 * @param c Request context
	 * @param pending The request
	 * @param params Code or error for the agent
	 */
	const back = (
		c: Pick<Context, "redirect">,
		pending: Pending,
		params: Record<string, string>,
	) => {
		const url = new URL(pending.redirect);
		for (const [name, value] of Object.entries(params))
			url.searchParams.set(name, value);
		if (pending.state !== null) url.searchParams.set("state", pending.state);
		url.searchParams.set("iss", origin);
		return c.redirect(url, 303);
	};

	/** Starts the passkey prompt for allowing an agent */
	const prompt = Route.post(paths.prompt)
		// the consent form's fields, the request is the one the passkey confirms
		.fields({ request: Field.hidden(), bootstrap: Field.hidden() })
		.use(async (c) => {
			c.res.headers.set(Header.name.cache, "no-store");
			if (!same(c)) return c.text("Forbidden", 403);

			if ((await authorizations.check(c, "approve")) !== true)
				return c.text("Too many requests. Try again later.", 429);

			const input = await c.data({ payload: 128 * Size.kb }).catch(Issue.body);
			if (!input || input.issues)
				return c.text("Authentication failed. Try again.", 400);

			const pending = await asked(c, input.data.request);
			if (!pending) return;

			try {
				await Passkey.issue(c, state(c), input.data.bootstrap, undefined, {
					method: "login",
					action: paths.approve,
					fields: await Passkey.fields({ request: input.data.request }),
					// only the asked user's passkeys can allow it
					allow: await storage.credentials.list(pending.user),
				});
			} catch (error) {
				if (!unverified(error)) throw error;
				return c.text("Authentication failed. Try again.", 400);
			}
		});

	/**
	 * Allows the agent. The user confirms with their passkey, so a script or
	 * agent driving a signed-in browser cannot allow it for them.
	 */
	const approve = Passkey.prepare(
		Route.post(paths.approve)
			.fields({ request: Field.hidden() })
			.use(async (c) => {
				c.res.headers.set(Header.name.cache, "no-store");
				if (!same(c)) return c.text("Forbidden", 403);

				const result = await c
					.data({ payload: 128 * Size.kb })
					.catch(Issue.body);
				if (!result || result.issues)
					return c.text("Your passkey could not be verified. Try again.", 400);

				const pending = await asked(c, result.data.request);
				if (!pending) return;

				let credential;
				try {
					// a passkey confirms the request it was asked for, not another
					credential = await new Passkey(c, state(c)).login(
						storage.credentials,
						await Passkey.fields({ request: result.data.request }),
						// the prompt offered only this user's passkeys
						pending.user,
					);
				} catch (error) {
					if (!unverified(error)) throw error;
					return c.text("Your passkey could not be verified. Try again.", 400);
				}
				// the passkey of the user who was asked
				if (credential.user !== pending.user) return c.text("Forbidden", 403);

				const code = random();
				await storage.tokens.set(code, {
					kind: "code",
					user: pending.user,
					client: pending.client,
					resource: pending.resource,
					scope: "",
					// compared at the exchange only when the request named it (OAuth 2.1)
					...(pending.named && { redirect: pending.redirect }),
					challenge: pending.challenge,
					expiration: Date.now() + lifetime.code,
				});

				return back(c, pending, { code });
			}),
	);

	/** Denies the agent, which needs no passkey */
	const deny = Route.post(paths.deny)
		// the consent form's fields, the passkey inputs are empty
		.fields({
			request: Field.hidden(),
			credential: Field.hidden().optional(),
			ceremony: Field.hidden().optional(),
		})
		.use(async (c) => {
			c.res.headers.set(Header.name.cache, "no-store");
			if (!same(c)) return c.text("Forbidden", 403);

			const result = await c.data({ payload: 128 * Size.kb }).catch(Issue.body);
			const pending = await asked(
				c,
				!result || result.issues ? null : result.data.request,
			);
			if (!pending) return;

			return back(c, pending, { error: "access_denied" });
		});

	// authorization server metadata, RFC 8414
	cross(
		Route.get(paths.metadata).use(host, cors, (c) =>
			c.json({
				issuer: origin,
				authorization_endpoint: origin + paths.authorize,
				token_endpoint: origin + paths.token,
				response_types_supported: ["code"],
				grant_types_supported: ["authorization_code", "refresh_token"],
				code_challenge_methods_supported: ["S256"],
				token_endpoint_auth_methods_supported: ["none"],
				client_id_metadata_document_supported: true,
				authorization_response_iss_parameter_supported: true,
			}),
		),
	);

	// the user's browser, which may be signed out: this remembers the request,
	// sends them to sign in, and resumes
	outside(
		Route.get(paths.authorize).use(host, async (c) => {
			c.res.headers.set(Header.name.cache, "no-store");
			const query = c.url.searchParams;

			if ((await authorizations.check(c)) !== true)
				return c.text("Too many requests. Try again later.", 429);

			const client = await agent(c, query.get("client_id"));
			if (client === null)
				return c.text("Could not load the agent. Try again later.", 503);
			if (!client) return c.text("Unknown client.", 400);

			const redirect = match(client.redirects, query.get("redirect_uri"));
			if (!redirect) return c.text("Invalid redirect URI.", 400);

			// answered here, not redirected: any client can publish a document
			// with any callback, which would make this origin an open redirector
			const error = (code: string, description: string) =>
				c.text(`${description} (${code})`, 400);

			if (query.get("response_type") !== "code")
				return error("unsupported_response_type", "Use the code flow.");

			const challenge = query.get("code_challenge");
			if (
				query.get("code_challenge_method") !== "S256" ||
				!challenge ||
				!/^[\w-]{43}$/.test(challenge)
			)
				return error("invalid_request", "PKCE with S256 is required.");

			// tokens are bound to the resource the agent will use them with
			const resource = query.get("resource");
			if (!resource) return error("invalid_target", "Resource is required.");
			let target: URL;
			try {
				target = new URL(resource);
			} catch {
				return error("invalid_target", "Invalid resource.");
			}
			// exactly an endpoint that accepts these tokens, such as an MCP endpoint
			if (!resources.has(target.href) || target.href !== resource)
				return error("invalid_target", "Unknown resource.");

			// a token grants everything the user can do, there are no narrower scopes
			if (query.get("scope"))
				return error("invalid_scope", "Scopes are not supported.");

			const session = await state(c).session();
			if (!session) {
				// come back here after logging in
				state(c).remember(c.url.pathname + c.url.search);
				return c.redirect(page, 303);
			}

			const url = new URL(consent, origin);
			url.searchParams.set(
				"request",
				await Token.seal(
					options.secret,
					"consent",
					JSON.stringify({
						client: client.id,
						name: client.name,
						redirect,
						named: query.has("redirect_uri"),
						challenge,
						resource,
						state: query.get("state"),
						user: session.user,
						expiration: Date.now() + lifetime.consent,
					} satisfies Pending),
				),
			);

			return c.redirect(url, 303);
		}),
	);

	// the signed-in user's own form posts, which stay the app's requests
	routes.push(prompt, approve, deny);

	cross(
		Route.post(paths.token).use(host, cors, async (c) => {
			if (!(await admit(c, limiter))) return;

			const text = await body(c);
			if (text === undefined) return fail(c, "invalid_request");
			const params = new URLSearchParams(text);

			// agents are public clients, one that authenticates expects a check
			// that is not made
			const scheme = c.req.headers.get("authorization")?.split(" ")[0];
			if (
				scheme ||
				["client_secret", "client_assertion", "client_assertion_type"].some(
					(name) => params.has(name),
				)
			) {
				if (scheme) c.res.headers.set("www-authenticate", scheme);
				return fail(
					c,
					"invalid_client",
					"Client authentication is not supported",
					scheme ? 401 : 400,
				);
			}

			const grant = params.get("grant_type");
			const client = params.get("client_id");
			const resource = params.get("resource");

			const code = grant === "authorization_code";
			if (!code && grant !== "refresh_token")
				return fail(c, "unsupported_grant_type");

			const access = random();
			const refresh = random();
			let error = "invalid_grant";
			/** How long the access token lasts, shorter near the grant's end */
			let expires = lifetime.access;

			// codes and refresh tokens are used once, refresh tokens rotate
			const issued = await storage.tokens.exchange(
				params.get(code ? "code" : "refresh_token") ?? "",
				code ? "code" : "refresh",
				async (token) => {
					if (token.client !== client) return;
					if (code) {
						const verifier = params.get("code_verifier") ?? "";
						if (
							(token.redirect !== undefined &&
								token.redirect !== params.get("redirect_uri")) ||
							!/^[\w.~-]{43,128}$/.test(verifier) ||
							(await hash(verifier)) !== token.challenge
						)
							return;
					}
					if (resource !== token.resource) {
						error = "invalid_target";
						return;
					}

					const now = Date.now();
					// a grant lasts from its approval, refreshing replaces its tokens but
					// never extends it, then the user connects the agent again
					const end = code ? now + lifetime.refresh : token.expiration;
					expires = Math.min(lifetime.access, end - now);
					const row = {
						user: token.user,
						client: token.client,
						resource: token.resource,
						scope: token.scope,
					};

					return {
						[access]: { ...row, kind: "access", expiration: now + expires },
						[refresh]: { ...row, kind: "refresh", expiration: end },
					};
				},
			);
			if (!issued) return fail(c, error);

			c.json({
				access_token: access,
				token_type: "Bearer",
				expires_in: Math.floor(expires / Time.second),
				refresh_token: refresh,
			});
		}),
	);

	return {
		routes,

		/**
		 * @param c Request context
		 * @returns The authorization request on the consent page, with its form
		 */
		async consent(c: Auth.Context): Promise<Auth.Consent | null> {
			// the page grants access, so other sites cannot frame it to trick a click
			c.res.headers.set("x-frame-options", "DENY");
			c.res.headers.append("content-security-policy", "frame-ancestors 'none'");

			const pending = await open(c.url.searchParams.get("request"));
			if (!pending) return null;

			const session = await state(c).session();
			if (!session || session.user !== pending.user) return null;

			const request = c.url.searchParams.get("request")!;
			// the page's passkey prompt is for this request only
			const Form = new Passkey(c, state(c)).form(approve, "login", {
				endpoint: prompt.url(),
				fields: await Passkey.fields({ request }),
			});

			return {
				client: { id: pending.client, name: pending.name },
				redirect: new URL(pending.redirect).host || pending.redirect,
				Form: (props) =>
					Form({
						...props,
						children: [
							jsx("input", { type: "hidden", name: "request", value: request }),
							props.children ?? [
								jsx("button", { children: "Allow" }),
								jsx("button", { formaction: deny.url(), children: "Deny" }),
							],
						],
					}),
			};
		},

		/**
		 * @param c Request context
		 * @param resource Resource the token must be issued for
		 * @returns Session for the user the token acts for
		 */
		async bearer(
			c: Pick<Context, "req">,
			resource: string,
		): Promise<Auth.Session | null> {
			const token = /^Bearer\s+([\w.~+/-]+=*)$/i.exec(
				c.req.headers.get("authorization") ?? "",
			)?.[1];
			if (!token) return null;

			const row = await storage.tokens.get(token);
			if (!row || row.resource !== resource) return null;

			return {
				id: await Storage.hash(token),
				user: row.user,
				expiration: row.expiration,
			};
		},
	};

	/**
	 * @param request Sealed authorization request
	 * @returns The request, unless it is invalid or expired
	 */
	async function open(request: string | null) {
		if (!request) return;
		try {
			const pending = JSON.parse(
				await Token.open(options.secret, "consent", request),
			) as Pending;
			if (pending.expiration > Date.now()) return pending;
		} catch (error) {
			if (!(error instanceof Issue) && !(error instanceof SyntaxError))
				throw error;
		}
	}
}

/**
 * @param text Text to hash
 * @returns Base64url SHA-256, as PKCE S256 uses
 */
function hash(text: string) {
	return Storage.hash(text);
}

/**
 * @param uri Redirect URI an agent registers
 * @returns `true` if it is HTTPS, a loopback address, or an app's own scheme
 */
function redirectable(uri: unknown) {
	if (typeof uri !== "string" || uri.length > 2000) return false;
	try {
		const url = new URL(uri);
		if (url.hash || url.username || url.password) return false;
		if (url.protocol === "https:") return true;
		if (url.protocol === "http:") return loopback(url.hostname);
		return ![
			"javascript:",
			"data:",
			"file:",
			"blob:",
			"vbscript:",
			"about:",
		].includes(url.protocol);
	} catch {
		return false;
	}
}

/** @returns `true` for loopback hosts */
function loopback(host: string) {
	return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * @param redirects Registered redirect URIs
 * @param uri Requested redirect URI
 * @returns The redirect URI to use, any port is allowed for loopback addresses
 */
function match(redirects: readonly string[], uri: string | null) {
	if (uri === null) return redirects.length === 1 ? redirects[0] : undefined;
	if (redirects.includes(uri)) return uri;

	try {
		const url = new URL(uri);
		if (url.protocol !== "http:" || !loopback(url.hostname)) return;
		for (const redirect of redirects) {
			const registered = new URL(redirect);
			registered.port = url.port;
			if (registered.href === url.href) return uri;
		}
	} catch {
		return;
	}
}

/**
 * @param id Client ID
 * @returns The URL of the agent's client ID metadata document
 */
function identify(id: string) {
	if (!id.startsWith("https://")) return;

	let url: URL;
	try {
		url = new URL(id);
	} catch {
		return;
	}
	if (url.pathname === "/" || url.hash || url.username || url.password) return;
	// exactly as written, so the ID shown reads as the origin it is, unlike
	// `https://evil.example\@good.example/`, which a URL parses as evil.example
	if (url.href !== id) return;

	return url;
}

/**
 * Fetches a client ID metadata document, the agent's ID is its URL.
 *
 * @param id Client ID
 * @param url Client ID, parsed
 * @returns The client, `undefined` if it has no valid document, or `null`
 * if the download failed for now
 */
async function find(id: string, url: URL): Promise<Client | null | undefined> {
	const metadata = (await Metadata.fetch(url)) as Record<
		string,
		unknown
	> | null;
	if (metadata === null) return null;
	const redirects = metadata?.redirect_uris;
	if (
		metadata?.client_id !== id ||
		!Array.isArray(redirects) ||
		!redirects.length ||
		!redirects.every(redirectable)
	)
		return;

	// agents are public clients here: one that declares only other ways to
	// authenticate, or other grants, is not treated as one that asked for less
	const methods = [
		metadata.token_endpoint_auth_method,
		metadata.token_endpoint_auth_methods_supported,
	]
		.flat()
		.filter((method) => method !== undefined);
	const offers = (declared: unknown, ours: string) =>
		declared === undefined ||
		(Array.isArray(declared) && declared.includes(ours));
	if (
		(methods.length && !methods.includes("none")) ||
		!offers(metadata.grant_types, "authorization_code") ||
		!offers(metadata.response_types, "code")
	)
		return;

	return {
		id,
		name:
			typeof metadata.client_name === "string" && metadata.client_name.trim()
				? metadata.client_name.trim().slice(0, 100)
				: url.host,
		redirects,
	};
}
