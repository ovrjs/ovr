import { type JSX, jsx } from "../jsx/index.js";
import type { Middleware } from "../middleware/index.js";
import { Form as FormSchema, Schema as ValueSchema } from "../schema/index.js";
import type { Trie } from "../trie/index.js";
import { Checksum, Method, Mime } from "../util/index.js";
import type { Util } from "../util/index.js";

/** Finishes a route's configuration, `app.use(route)` calls it */
export const freeze = Symbol("freeze");

/**
 * Matches a pattern's parameters, as the router reads them: `:name` up to the
 * next slash, anywhere in a segment, and a final `*`, the wildcard, which
 * has no name. Internal to ovr.
 */
export const parameters = /:([^/]+?)(?=\/|\*?$)|\*$/g;

/**
 * Helper type to extract the route params (`:slug`) into a record.
 *
 * @template Pattern Route pattern to extract params from
 */
export type ExtractParams<Pattern extends string = string> =
	Pattern extends `${infer _Start}:${infer Param}/${infer Rest}`
		? { [k in Param | keyof ExtractParams<Rest>]: string }
		: Pattern extends `${infer _Start}:${infer Param}`
			? { [k in Param]: string }
			: Pattern extends `${infer _Rest}*`
				? { "*": string }
				: {};

/**
 * `S` without leading or trailing whitespace
 *
 * @template S String to trim
 */
type Trim<S extends string> = S extends ` ${infer R}` | `${infer R} `
	? Trim<R>
	: S extends `\n${infer R}` | `${infer R}\n` | `\t${infer R}` | `${infer R}\t`
		? Trim<R>
		: S;

/**
 * Helper type to insert a record of params into a resolved string.
 *
 * @template Pattern Route pattern to resolve
 * @template Params Params to insert into pattern
 */
export type InsertParams<
	Pattern extends string,
	Params extends Trie.Params,
> = Pattern extends `${infer Start}:${infer Param}/${infer Rest}`
	? Param extends keyof Params
		? `${Start}${Params[Param]}/${InsertParams<Rest, Params>}`
		: Pattern
	: Pattern extends `${infer Start}:${infer Param}`
		? Param extends keyof Params
			? `${Start}${Params[Param]}`
			: Pattern
		: Pattern extends `${infer Start}*`
			? "*" extends keyof Params
				? `${Start}${Params["*"]}`
				: Pattern
			: Pattern;

export namespace Route {
	/** HTTP Method */
	export type Method =
		| "GET"
		| "HEAD"
		| "POST"
		| "PUT"
		| "DELETE"
		| "CONNECT"
		| "OPTIONS"
		| "TRACE"
		| "PATCH"
		| (string & {});

	/** How agents call a route, from `route.tool`. */
	export type Tool = {
		/** Tool name, for example `post_posts_id_delete` */
		readonly name: string;
		/** What the tool does */
		readonly description: string;
		/** Only reads, a GET; other tools may change data, so agents can confirm them */
		readonly read: boolean;
	};

	/**
	 * Schemas for route pattern parameters, keyed by parameter name.
	 *
	 * @template Pattern Route pattern
	 */
	export type ParamSchemas<Pattern extends string> = {
		readonly [K in keyof ExtractParams<Pattern>]?: ValueSchema<unknown>;
	};

	/**
	 * Route parameters after their schemas convert them.
	 *
	 * @template Params Current parameters
	 * @template P Parameter schemas
	 */
	export type Converted<Params, P> = Util.Prettify<
		Omit<Params, keyof P> & { [K in keyof P]: ValueSchema.Infer<P[K]> }
	>;

	// these types are needed for proper JSDoc on `get` and `post` return types
	/**
	 * Helper type for a route with a `<Button>` component.
	 *
	 * @template Pattern Route pattern
	 */
	type WithButton<Pattern extends string = string> = {
		/** `<button>` component with preset `formaction` and `formmethod` attributes */
		readonly Button: Route.Button<Pattern>;
	};

	/**
	 * Helper type for a route with a `<Form>` component.
	 *
	 * @template Pattern Route pattern
	 */
	type WithForm<Pattern extends string = string> = {
		/** `<form>` component with preset `method` and `action` attributes */
		readonly Form: Route.Form<Pattern>;
	};

	/**
	 * Helper type for a route with a `<Anchor>` component.
	 *
	 * @template Pattern Route pattern
	 */
	type WithAnchor<Pattern extends string = string> = {
		/** `<a>` component with preset `href` attribute */
		readonly Anchor: Route.Anchor<Pattern>;
	};

	/**
	 * Form method subset attached to route helper types.
	 *
	 * Omits `component` so schema-specific `component` signatures are not widened when a
	 * concrete `Form<S>` is intersected onto the route type.
	 */
	type FormMethods = Omit<Route.Schema<any>, "component">;

	/**
	 * Optional form helper methods available when a route may have a schema.
	 *
	 * Function members are wrapped with bivariant parameters so routes can be
	 * structurally assigned across compatible generic instances.
	 */
	type MaybeForm = {
		// maybe schema assigned - makes route.Fields?.() possible
		[K in keyof FormMethods]?: FormMethods[K] extends (...args: any[]) => any
			? Util.Bivariant<FormMethods[K]>
			: FormMethods[K];
	};

	/**
	 * Schema helpers once `route.fields()` sets a shape.
	 *
	 * @template Shape Form field shape
	 */
	type WithSchema<Shape extends FormSchema.Shape> = [FormSchema.Shape] extends [
		Shape,
	]
		? MaybeForm
		: Route.Schema<Shape>;

	/**
	 * GET route type with route components and optional schema helpers.
	 *
	 * @template Pattern Route pattern
	 * @template Params Parameters passed to middleware
	 * @template Shape Form field shape
	 */
	export type Get<
		Pattern extends string = string,
		Params extends Route.ParamsBase = any,
		Shape extends FormSchema.Shape = any,
	> = Route<Pattern, Params, Shape, "get"> &
		WithAnchor<Pattern> &
		WithButton<Pattern> &
		WithForm<Pattern> &
		WithSchema<Shape>;

	/**
	 * POST route type with route components and optional schema helpers.
	 *
	 * @template Pattern Route pattern
	 * @template Params Parameters passed to middleware
	 * @template Shape Form field shape
	 */
	export type Post<
		Pattern extends string = string,
		Params extends Route.ParamsBase = any,
		Shape extends FormSchema.Shape = any,
	> = Route<Pattern, Params, Shape, "post"> &
		WithButton<Pattern> &
		WithForm<Pattern> &
		WithSchema<Shape>;

	/** Components a route has: GET routes add an `<Anchor>` */
	export type Kind = "get" | "post" | "plain";

	/**
	 * A route of the given kind.
	 *
	 * @template K Route kind
	 * @template Pattern Route pattern
	 * @template Params Parameters passed to middleware
	 * @template Shape Form field shape
	 */
	export type Of<
		K extends Route.Kind,
		Pattern extends string,
		Params extends Route.ParamsBase,
		Shape extends FormSchema.Shape,
	> = K extends "get"
		? Route.Get<Pattern, Params, Shape>
		: K extends "post"
			? Route.Post<Pattern, Params, Shape>
			: Route<Pattern, Params, Shape, K>;

	/** Parameters passed to middleware, strings unless a schema converts them */
	export type ParamsBase = Record<string, unknown>;

	/**
	 * Schema helper type attached to routes that have a form schema.
	 *
	 * @template S Form field shape
	 */
	export type Schema<S extends FormSchema.Shape = FormSchema.Shape> =
		FormSchema<S>;

	/**
	 * Options to construct a relative URL from the route.
	 *
	 * @template Params Parameters created from a route match
	 */
	export type URLOptions<Params extends Trie.Params> = {
		/**
		 * Passed into `URLSearchParams` constructor to create new params.
		 *
		 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams)
		 */
		readonly search?:
			| string
			// Iterable is more accurate than the built in string[][] + URLSearchParams
			// https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/2070
			| Iterable<[string, string]>
			| Record<string, string>
			| undefined;

		/**
		 * Hash (fragment) of the URL. `"#"` prefix is added if not present.
		 *
		 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/URL/hash)
		 */
		readonly hash?: string | undefined;
	} & (keyof Params extends never
		? {
				/** Route pattern does not contain parameters */
				readonly params?: undefined;
			}
		: {
				/** Route pattern parameters */
				readonly params: Params;
			});

	/**
	 * Type of `route.url(options)`: the exact path with the given `params`,
	 * or a `string` once `search` or `hash` is added.
	 *
	 * @template Pattern Route pattern
	 * @template O URL options
	 */
	export type Href<Pattern extends string, O> = [
		Present<O, "search">,
		Present<O, "hash">,
	] extends [never, never]
		? InsertParams<
				Pattern,
				O extends { readonly params: infer P extends Trie.Params } ? P : {}
			>
		: string;

	/**
	 * A given option's value, `never` when it is missing or `undefined`.
	 *
	 * @template O Options
	 * @template K Option name
	 */
	type Present<O, K extends string> = K extends keyof O
		? NonNullable<O[K]>
		: never;

	/**
	 * `<Anchor>` route component type
	 *
	 * @template Pattern Route pattern
	 */
	export type Anchor<Pattern extends string> = (
		props: JSX.IntrinsicElements["a"] & URLOptions<ExtractParams<Pattern>>,
	) => JSX.Element;

	/**
	 * `<Button>` route component type
	 *
	 * @template Pattern Route pattern
	 */
	export type Button<Pattern extends string> = (
		props: JSX.IntrinsicElements["button"] & URLOptions<ExtractParams<Pattern>>,
	) => JSX.Element;

	/**
	 * `<Form>` route component type
	 *
	 * @template Pattern Route pattern
	 */
	export type Form<Pattern extends string> = (
		props: JSX.IntrinsicElements["form"] &
			URLOptions<ExtractParams<Pattern>> & {
				/** Current page URL, restores the state of an invalid submission */
				state?: URL | undefined;
				/** Initial field values, for example the record being edited */
				values?: Readonly<Record<string, unknown>> | undefined;
				/** Label of the generated submit button, defaults to "Submit" */
				submit?: JSX.Element | undefined;
			},
	) => JSX.Element;

	/**
	 * Extract params from a Route instance.
	 *
	 * @template Route Route with pattern to extract params from
	 */
	export type Params<Route> = Route extends { pattern: infer P }
		? P extends string
			? ExtractParams<P>
			: never
		: never;
}

/**
 * Route to use in the application.
 *
 * Each method adds to the route and returns it, so a route reads as a chain:
 *
 * ```ts
 * const update = Route.post("/posts/:id")
 * 	.describe("Change a post's title or body")
 * 	.params({ id: Schema.string().uuid() })
 * 	.fields({ title, body })
 * 	.use(async (c) => {
 * 		// ...
 * 	});
 * ```
 *
 * @template Pattern Route pattern
 * @template Params Parameters passed to middleware
 * @template Shape Form field shape
 * @template Kind Components the route has
 */
export class Route<
	Pattern extends string = string,
	// any by default so a `Route` type accepts every route
	Params extends Route.ParamsBase = any,
	Shape extends FormSchema.Shape = any,
	Kind extends Route.Kind = any,
> {
	/** HTTP method */
	readonly method: Route.Method;

	/** Description for agents */
	#description?: string;

	/** Schemas that check and convert pattern parameters */
	#paramSchemas?: Readonly<Record<string, ValueSchema<unknown>>>;

	/** Mounted, so its configuration is final */
	#frozen = false;

	/** Route pattern */
	readonly #pattern: Pattern;

	/** Middleware added with `use` */
	readonly #stack: Middleware<any, any>[] = [];

	/**
	 * Create a new route.
	 *
	 * @param method HTTP Method
	 * @param pattern Route pattern
	 */
	constructor(method: Route.Method, pattern: Pattern) {
		this.method = method;
		this.#pattern = pattern;
	}

	/** Description for agents, only described routes are served to them */
	get description() {
		return this.#description;
	}

	/** Schemas that check and convert pattern parameters */
	get paramSchemas() {
		return this.#paramSchemas;
	}

	/** Route pattern */
	get pattern(): Pattern {
		return this.#pattern;
	}

	/** Route middleware stack, runs after global middleware */
	get middleware(): Middleware<any, any>[] {
		const schemas = this.paramSchemas;
		if (!schemas) return this.#stack;

		return [
			(c, next) => {
				for (const name in schemas) {
					const result = schemas[name]!.parse(c.params[name]);

					// a parameter that does not match is a resource that does not exist
					if (result.issues) return void (c.res.status = 404);

					c.params[name] = result.data;
				}

				return next();
			},
			...this.#stack,
		];
	}

	/**
	 * The tool agents call the route as, through MCP and the route's `Form`.
	 * Only described routes are tools, so mounting a route never lets agents
	 * call it; GET tools are read-only.
	 */
	get tool(): Route.Tool | undefined {
		if (!this.description || this.method === Method.head) return;

		const read = this.method === Method.get;

		const segments = this.pattern
			.split("/")
			.filter(Boolean)
			.map((segment) =>
				segment === "*" ? "wildcard" : segment.replace(/^:/, ""),
			);

		let name = `${this.method.toLowerCase()}_${segments.join("_") || "index"}`;

		// `_` and other punctuation could make two patterns' names the same,
		// such as `/a/b` and `/a_b`, so those names end with the pattern's hash
		if (
			!segments.every((segment) => /^[A-Za-z0-9-]+$/.test(segment)) ||
			name.length > 64
		)
			name = `${name
				.replace(/[^\w-]+/g, "_")
				.replace(/_+/g, "_")
				.slice(
					0,
					56,
				)}_${Checksum.djb2(`${this.method} ${this.pattern}`).slice(0, 7)}`;

		return { name, description: this.description, read };
	}

	/**
	 * Describe the route for agents. Only described routes are served to
	 * them: as MCP tools, and GET routes as resources too.
	 *
	 * @template D Description, a string literal that is not blank
	 * @param description What the route does, written for an agent, not blank
	 * @returns The route
	 */
	describe<D extends string>(
		description: Trim<D> extends ""
			? never
			: // `:wildcard` and `*` would both be the tool's `wildcard` argument
				["wildcard" | "*"] extends [keyof ExtractParams<Pattern>]
				? "Rename :wildcard, a tool's * argument is named wildcard"
				: D,
	) {
		this.#configure("describe");
		this.#description = description;
		return this;
	}

	/**
	 * Check and convert pattern parameters before the middleware runs.
	 * A parameter that fails its schema responds `404`.
	 *
	 * @template P Schemas keyed by parameter name
	 * @param schemas Schemas keyed by parameter name
	 * @returns The route, with converted `c.params` types
	 */
	params<P extends Route.ParamSchemas<Pattern>>(
		// a name the pattern does not have is a type error
		schemas: P,
	): Route.Of<Kind, Pattern, Route.Converted<Params, P>, Shape> {
		this.#configure("params");
		this.#before("params");

		this.#paramSchemas = { ...this.#paramSchemas, ...schemas } as Record<
			string,
			ValueSchema<unknown>
		>;

		return this as any;
	}

	/**
	 * Set the form fields that `c.data()` parses, and that the route's `Form`
	 * renders by default.
	 *
	 * @template S Field shape
	 * @param fields Field shape or form schema
	 * @returns The route with form helpers
	 */
	fields<S extends FormSchema.Shape>(
		fields: S | FormSchema<S>,
	): Route.Of<Kind, Pattern, Params, S> {
		this.#configure("fields");
		this.#before("fields");
		return Object.assign(this, FormSchema.from(fields)) as any;
	}

	/**
	 * A mounted route is final, so the app's tools and middleware stay as
	 * they were when it was mounted.
	 *
	 * @param method Method that changes the route
	 */
	#configure(method: string) {
		if (this.#frozen)
			throw new TypeError(
				`Call .${method}() before app.use() on route "${this.pattern}".`,
			);
	}

	/** Finish the configuration, when an app mounts the route. */
	[freeze]() {
		this.#frozen = true;
	}

	/**
	 * Middleware is typed by the params and fields set before it, so they
	 * cannot change after it is added.
	 *
	 * @param method Method that changes the types
	 */
	#before(method: string) {
		if (this.#stack.length)
			throw new TypeError(
				`Call .${method}() before .use() on route "${this.pattern}".`,
			);
	}

	/**
	 * Add middleware to the route. The last one usually responds.
	 *
	 * @param middleware Route middleware
	 * @returns The route
	 */
	use(...middleware: Middleware<Params, Shape>[]) {
		this.#configure("use");
		this.#stack.push(...middleware);
		return this;
	}

	/**
	 * Construct a _relative_ URL for the route. Parameter values are encoded,
	 * so each stays in its own segment, and a wildcard keeps its slashes.
	 *
	 * @template O Options, the exact path type when only `params` are given
	 * @param [options] Parameters, search, and hash
	 * @returns `pathname` + `search` + `hash`
	 */
	url<O extends object = {}>(
		...[options]: keyof ExtractParams<Pattern> extends never
			? [(O & Route.URLOptions<ExtractParams<Pattern>>)?]
			: [O & Route.URLOptions<ExtractParams<Pattern>>]
	): Route.Href<Pattern, O> {
		const params = options?.params as Record<string, string> | undefined;
		const path = params
			? this.pattern.replace(parameters, (_, name?: string) =>
					name
						? Route.#segment(params[name]!)
						: // the wildcard keeps its slashes, each of its segments is encoded
							params["*"]!.split("/")
								.map((segment) => (segment ? Route.#segment(segment) : segment))
								.join("/"),
				)
			: this.pattern;
		// a value starting with a slash, such as a wildcard of `/host/path`,
		// would make a path that browsers read as another origin
		if (path.startsWith("//"))
			throw new TypeError(
				`Route path "${path}" would start with "//", which is read as another host`,
			);
		const { search, hash } = options ?? {};

		return (path +
			(search
				? // use the value as the init
					"?" +
					new URLSearchParams(
						search as ConstructorParameters<typeof URLSearchParams>[0],
					)
				: "") +
			(hash
				? // adding # prefix if not present matches the URL setter:
					// https://developer.mozilla.org/en-US/docs/Web/API/URL/hash
					hash[0] === "#"
					? hash
					: "#" + hash
				: "")) as Route.Href<Pattern, O>;
	}

	/**
	 * @param value Parameter value
	 * @returns The value encoded as one segment
	 * @throws When it would not stay in its segment: empty, `.`, or `..`,
	 * which a URL resolves away
	 */
	static #segment(value: string) {
		if (value === "" || value === "." || value === "..")
			throw new TypeError(
				`Route parameter "${value}" cannot be a path segment, it would change the path`,
			);
		return encodeURIComponent(value);
	}

	/**
	 * @template Pattern Route pattern
	 * @param route Route to add components to
	 * @returns Route with added components
	 */
	static #withComponents<Pattern extends string>(route: Route<Pattern>) {
		const enctype = route.method === Method.post ? Mime.type.mp : undefined;

		return Object.assign(route, {
			Button: (({ params, search, hash, ...rest }) =>
				jsx("button", {
					formaction: route.url({ params, search, hash } as Route.URLOptions<
						ExtractParams<Pattern>
					>),
					formmethod: route.method,
					formenctype: enctype,
					...rest,
				})) as Route.Button<Pattern>,
			Form: (({
				params,
				search,
				hash,
				state,
				values,
				submit = "Submit",
				...rest
			}) => {
				let query: URLSearchParams | undefined;

				if (route.method === Method.post && state) {
					const target = new URL(state);

					for (const param of FormSchema.params) {
						target.searchParams.delete(param);
					}

					query = new URLSearchParams(
						// @ts-expect-error - see type above
						search,
					);

					query.set(
						FormSchema.params[0],
						target.pathname + target.search + target.hash,
					);
				}

				const { Fields } = route as Route.Post<Pattern>;
				const { tool } = route;

				return jsx("form", {
					action: route.url({
						params,
						search: query ?? search,
						hash,
					} as Route.URLOptions<ExtractParams<Pattern>>),
					method: route.method,
					enctype,
					// default to the fields, if any, and a submit button, so a form
					// without fields, such as a delete, is still one to submit
					children: [
						Fields?.({ state, values }),
						jsx("button", { children: submit }),
					],
					// WebMCP, browser agents call the form as the route's tool. A form
					// bound to a parameter, like a delete form in each row, would repeat
					// the name, so those set the attributes themselves when they are unique
					...(tool &&
						!/[:*]/.test(route.pattern) && {
							toolname: tool.name,
							tooldescription: tool.description,
							// a form that may change data waits for the user to submit it
							toolautosubmit: tool.read,
						}),
					...rest,
				});
			}) as Route.Form<Pattern>,
		});
	}

	/**
	 * @template Pattern Route pattern
	 * @param pattern Route pattern
	 * @returns GET `Route` with added components
	 */
	static get<Pattern extends string>(pattern: Pattern) {
		const route = Route.#withComponents(new Route(Method.get, pattern));

		return Object.assign(route, {
			Anchor: (({ params, search, hash, ...rest }) =>
				jsx("a", {
					href: route.url({ params, search, hash } as Route.URLOptions<
						ExtractParams<Pattern>
					>),
					...rest,
				})) as Route.Anchor<Pattern>,
		}) as Route.Get<Pattern, ExtractParams<Pattern>, FormSchema.Shape>;
	}

	/**
	 * @template Pattern Route pattern
	 * @param pattern Route pattern
	 * @returns POST `Route` with added components
	 */
	static post<Pattern extends string>(pattern: Pattern) {
		return Route.#withComponents(new Route(Method.post, pattern)) as Route.Post<
			Pattern,
			ExtractParams<Pattern>,
			FormSchema.Shape
		>;
	}
}
