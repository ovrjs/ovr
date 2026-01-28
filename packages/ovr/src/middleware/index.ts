import type { Auth as AuthType } from "../auth/index.js";
import type { Context as ContextType } from "../context/index.js";
import type { Cookie as CookieType } from "../cookie/index.js";
import type { Trie } from "../trie/index.js";

export namespace Middleware {
	export namespace Context {
		export namespace Cookie {
			export type Options = CookieType.Options;
		}

		export namespace Auth {
			export type Session = AuthType.Session;
		}
	}

	/**
	 * Middleware context.
	 *
	 * @template Params Parameters created from a route match
	 * @template Data Parsed form data
	 */
	export type Context<
		Params extends Trie.Params = Trie.Params,
		Data = unknown,
	> = ContextType<Params, Data>;

	/** Dispatches the next middleware in the stack */
	export type Next = () => Promise<void>;
}

/**
 * App middleware.
 *
 * @template Params Parameters created from a route match
 * @param context Request context
 * @param next Dispatches the next middleware in the stack
 * @returns `Response` or element(s) to stream as HTML
 */
export type Middleware<
	Params extends Trie.Params = Trie.Params,
	Data = unknown,
> = (context: Middleware.Context<Params, Data>, next: Middleware.Next) => any;
