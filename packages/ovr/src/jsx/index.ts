import { Render } from "../render/index.js";
import type { MaybeFunction, MaybePromise } from "../types/index.js";
import type { IntrinsicElements as IE } from "./elements.js";

export namespace JSX {
	/** Standard HTML elements */
	export interface IntrinsicElements extends IE {}

	/** JSX Element */
	export type Element = MaybeFunction<
		MaybePromise<
			| string
			| number
			| bigint
			| boolean
			| object
			| null
			| undefined
			| Symbol
			| Iterable<Element>
			| AsyncIterable<Element>
		>
	>;

	/** Unknown component props */
	export type Props = Record<string, JSX.Element>;
}

/** ovr JSX */
export class JSX {
	/**
	 * These are the HTML tags that do not require a closing tag.
	 *
	 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Glossary/Void_element#self-closing_tags)
	 */
	static readonly #voidElements = new Set([
		"area",
		"base",
		"br",
		"col",
		"embed",
		"hr",
		"img",
		"input",
		"link",
		"meta",
		"source",
		"track",
		"wbr",
	]);

	/**
	 * The main function of the JSX transform cycle, each time JSX is encountered
	 * it is passed into `jsx` to be resolved.
	 *
	 * @param tag tag name or function component
	 * @param props object containing all the properties and attributes passed to the element or component
	 * @yields `Chunk`s of HTML
	 */
	static async *jsx<P extends JSX.Props = JSX.Props>(
		tag: ((props: P) => JSX.Element) | string,
		props: P,
	) {
		// this function doesn't need to be called recursively
		// JSX will be transformed into `jsx()` function calls automatically

		if (typeof tag === "function") {
			// component or fragment
			yield* new Render(tag(props));
			return;
		}

		if (tag === "html") yield Render.html("<!doctype html>");

		// intrinsic element
		// faster to concatenate attributes than to yield them as separate chunks
		let attributes = "";

		for (const key in props) {
			// more memory efficient to skip children instead of destructuring and using ...rest
			if (key === "children") continue;

			const value = props[key];

			if (value === true) {
				// just put the key without the value
				attributes += ` ${key}`;
			} else if (typeof value === "string") {
				attributes += ` ${key}="${Render.escape(value, true)}"`;
			} else if (typeof value === "number" || typeof value === "bigint") {
				attributes += ` ${key}="${value}"`;
			}
			// otherwise, don't include the attribute
		}

		yield Render.html(`<${tag}${attributes}>`);

		if (JSX.#voidElements.has(tag)) return;

		yield* new Render(props.children);

		yield Render.html(`</${tag}>`);
	}

	/**
	 * JSX requires a `Fragment` export to resolve `<></>`
	 *
	 * @param props containing `children` to render
	 * @yields concatenated children
	 */
	static async *Fragment(props: { children?: JSX.Element }) {
		yield* new Render(props.children);
	}
}

export const { jsx, Fragment } = JSX;
