import type { Context } from "../context/index.js";
import type { Trie } from "../trie/index.js";

export namespace Middleware {
	/**
	 * Middleware context.
	 *
	 * @template Params Parameters created from a route match
	 */
	export type Context<Params extends Trie.Params = Trie.Params> = InstanceType<
		typeof Context<Params>
	>;

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
export type Middleware<Params extends Trie.Params = Trie.Params> = (
	context: Middleware.Context<Params>,
	next: Middleware.Next,
) => any;
