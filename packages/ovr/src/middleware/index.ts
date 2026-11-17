import type { Context as ContextType } from "../context/index.js";
import type { Field } from "../form/index.js";

export namespace Middleware {
	/**
	 * The context a middleware is given, which can answer the request: set
	 * headers and cookies, redirect, and parse the body. Name it for a function
	 * of your own that does one of those. One that only reads the request
	 * takes a `Context`, which this fits.
	 *
	 * @template Params Parameters created from a route match
	 * @template Shape Parsed form data shape
	 */
	export type Context<
		Params extends Record<string, unknown> = Record<string, unknown>,
		// any, so middleware written on its own fits a route with fields
		Shape extends Field.Shape = any,
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
	Params extends Record<string, unknown> = Record<string, unknown>,
	Shape extends Field.Shape = any,
> = (context: ContextType<Params, Shape>, next: Middleware.Next) => any;
