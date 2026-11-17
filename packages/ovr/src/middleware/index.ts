import type { Context } from "../context/index.js";
import type { Field } from "../form/index.js";

export namespace Middleware {
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
	Params extends Record<string, unknown> = Record<string, unknown>,
	Shape extends Field.Shape = any,
> = (context: Context<Params, Shape>, next: Middleware.Next) => any;
