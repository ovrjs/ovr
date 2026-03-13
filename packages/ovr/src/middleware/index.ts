import type { Context as ContextType } from "../context/index.js";
import type { Cookie as CookieType } from "../cookie/index.js";
import type { Form } from "../schema/index.js";
import type { Trie } from "../trie/index.js";

export namespace Middleware {
	export namespace Context {
		export namespace Cookie {
			export type Options = CookieType.Options;
		}
	}

	/**
	 * Middleware context.
	 *
	 * @template Params Parameters created from a route match
	 * @template Shape Parsed form data shape
	 */
	export type Context<
		Params extends Trie.Params = Trie.Params,
		Shape extends Form.Shape = Form.Shape,
	> = ContextType<Params, Shape>;

	/** Dispatches the next middleware in the stack */
	export type Next = () => Promise<void>;
}

/**
 * App middleware.
 *
 * @template Params Parameters created from a route match
 * @template Shape Parsed form data shape
 * @param context Request context
 * @param next Dispatches the next middleware in the stack
 * @returns `Response` or element(s) to stream as HTML
 */
export type Middleware<
	Params extends Trie.Params = Trie.Params,
	Shape extends Form.Shape = Form.Shape,
> = (context: ContextType<Params, Shape>, next: Middleware.Next) => any;
