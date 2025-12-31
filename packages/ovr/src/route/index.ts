import { type JSX, jsx } from "../jsx/index.js";
import type { Middleware } from "../middleware/index.js";
import type { Trie } from "../trie/index.js";
import { Checksum, Method, Mime } from "../util/index.js";

/** Helper type to extract the route params (`:slug`) into a record */
export type ExtractParams<Pattern extends string = string> =
	Pattern extends `${infer _Start}:${infer Param}/${infer Rest}`
		? { [k in Param | keyof ExtractParams<Rest>]: string }
		: Pattern extends `${infer _Start}:${infer Param}`
			? { [k in Param]: string }
			: Pattern extends `${infer _Rest}*`
				? { "*": string }
				: {};

/** Helper type to insert a record of params into a resolved string */
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
			| Record<string, string>;

		/**
		 * Hash (fragment) of the URL. `"#"` prefix is added if not present.
		 *
		 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/URL/hash)
		 */
		readonly hash?: string;
	} & (keyof Params extends never
		? {
				/** Route pattern does not contain parameters */
				readonly params?: never;
			}
		: {
				/** Route pattern parameters */
				readonly params: Params;
			});

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
		props: JSX.IntrinsicElements["form"] & URLOptions<ExtractParams<Pattern>>,
	) => JSX.Element;

	/** Extract params from a Route instance. */
	export type Params<R> = R extends { pattern: infer P }
		? P extends string
			? ExtractParams<P>
			: never
		: never;
}

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
 * Route to use in the application.
 *
 * @template Pattern Route pattern
 */
export class Route<Pattern extends string = string> {
	/** Route pattern */
	readonly pattern: Pattern;

	/** HTTP method */
	readonly method: Route.Method;

	/** Route middleware stack, runs after global middleware */
	readonly middleware: Middleware<any>[]; // any so you can use other middleware

	/** Pattern parts */
	#parts: string[];

	/**
	 * Create a new route.
	 *
	 * @param method HTTP Method
	 * @param pattern Route pattern
	 * @param middleware Route middleware
	 */
	constructor(
		method: Route.Method,
		pattern: Pattern,
		...middleware: Middleware<ExtractParams<Pattern>>[]
	) {
		this.method = method;
		this.pattern = pattern;
		this.middleware = middleware;
		this.#parts = pattern.split("/");
	}

	/**
	 * Constructs a _relative_ URL for the route.
	 *
	 * @param [options] Options with type safe pathname parameters
	 * @returns `pathname` + `search` + `hash`
	 */
	url(
		...[options]: keyof ExtractParams<Pattern> extends never
			? [Route.URLOptions<ExtractParams<Pattern>>] | []
			: [Route.URLOptions<ExtractParams<Pattern>>]
	) {
		const pathname = this.pathname(
			// @ts-expect-error - do not have to pass in {} if no params
			options?.params,
		);
		let search = "";
		let hash = "";

		if (options?.search) {
			// use the value as the init
			// @ts-expect-error - see above
			search = "?" + new URLSearchParams(options.search);
		}

		if (options?.hash) {
			// adding # prefix if not present matches the URL setter:
			// https://developer.mozilla.org/en-US/docs/Web/API/URL/hash
			if (options.hash.startsWith("#")) {
				hash = options.hash;
			} else {
				hash = "#" + options.hash;
			}
		}

		return pathname + search + hash;
	}

	/**
	 * @template Params Parameters to create the pathname with
	 * @param [params] Parameters to insert
	 * @returns Resolved `pathname` with params
	 */
	pathname<Params extends ExtractParams<Pattern>>(
		...[params]: keyof Params extends never ? [] : [Params]
	): InsertParams<Pattern, Params> {
		if (!params) return this.pattern as InsertParams<Pattern, Params>;

		return this.#parts
			.map((part) => {
				if (part.startsWith(":")) {
					return params[part.slice(1) as keyof typeof params];
				}

				if (part === "*") return params[part as keyof typeof params];

				return part;
			})
			.join("/") as InsertParams<Pattern, Params>;
	}

	/**
	 * @template Pattern Route pattern
	 * @param route Route to add components to
	 * @returns Route with added components
	 */
	static #withComponents<Pattern extends string>(route: Route<Pattern>) {
		const enctype =
			route.method === Method.post ? Mime.multipartFormData : undefined;

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
			Form: (({ params, search, hash, ...rest }) =>
				jsx("form", {
					action: route.url({ params, search, hash } as Route.URLOptions<
						ExtractParams<Pattern>
					>),
					method: route.method,
					enctype,
					...rest,
				})) as Route.Form<Pattern>,
		});
	}

	/**
	 * @template Pattern Route pattern
	 * @param pattern Route pattern
	 * @param middleware GET middleware
	 * @returns GET `Route` with added components
	 */
	static get<Pattern extends string>(
		pattern: Pattern,
		...middleware: Middleware<ExtractParams<Pattern>>[]
	): Route<Pattern> &
		WithButton<Pattern> &
		WithForm<Pattern> &
		WithAnchor<Pattern> {
		const route = Route.#withComponents(
			new Route(Method.get, pattern, ...middleware),
		);

		return Object.assign(route, {
			Anchor: (({ params, search, hash, ...rest }) =>
				jsx("a", {
					href: route.url({ params, search, hash } as Route.URLOptions<
						ExtractParams<Pattern>
					>),
					...rest,
				})) as Route.Anchor<Pattern>,
		});
	}

	/**
	 * @param middleware POST middleware
	 * @returns POST `Route` with added components
	 */
	static post(middleware: Middleware<{}>): Route & WithButton & WithForm;
	/**
	 * @template Pattern Route pattern
	 * @param pattern Route pattern
	 * @param middleware POST middleware
	 * @returns POST `Route` with added components
	 */
	static post<Pattern extends string>(
		pattern: Pattern,
		...middleware: Middleware<ExtractParams<Pattern>>[]
	): Route<Pattern> & WithButton<Pattern> & WithForm<Pattern>;
	static post<Pattern extends string>(
		patternOrMiddleware: Pattern | Middleware<ExtractParams<Pattern>>,
		...middleware: Middleware<ExtractParams<Pattern>>[]
	) {
		let pattern: Pattern;

		if (typeof patternOrMiddleware === "string") {
			pattern = patternOrMiddleware;
		} else {
			middleware.unshift(patternOrMiddleware);
			pattern = `/_p/${Checksum.djb2(middleware.join())}` as Pattern;
		}

		return Route.#withComponents(
			new Route(Method.post, pattern, ...middleware),
		);
	}
}
