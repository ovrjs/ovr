import type { Cookie as CookieType } from "../cookie/index.js";
import type { Field } from "../form/index.js";
import type { Context as Full } from "./index.js";

/**
 * A request's context as anything on a page reads it: what a component is
 * given, and what a function that only reads the request takes. It has no
 * way to answer the request, since a component runs once the response has
 * begun: a header, a cookie, or a redirect from one would be lost. A
 * handler's context is a `Middleware.Context`, which has them, and fits
 * wherever this one is asked for.
 *
 * @template Params Parameters created from a route match
 */
export interface Context<
	Params extends Record<string, unknown> = Record<string, unknown>,
> extends Pick<
	Full<Params>,
	"req" | "ip" | "url" | "params" | "route" | "session" | "memo"
> {
	/** Get the request's cookies. */
	readonly cookie: Pick<CookieType, "get">;
}

export namespace Context {
	export namespace Cookie {
		/** Options of a cookie */
		export type Options = CookieType.Options;
	}

	/** A signed-in user's revocable session. */
	export type Session = Full.Session;

	/**
	 * `c.data()` return type: `null` for a route without fields, and either
	 * where the fields are not known, such as in middleware written on its own.
	 *
	 * @template S Form shape, `any` where it is not known
	 */
	export type Result<S extends Field.Shape> = Full.Result<S>;
}
