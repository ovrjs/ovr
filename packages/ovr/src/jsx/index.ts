import { Render } from "../render/index.js";
import type { IntrinsicElements as IE } from "./elements.js";

export namespace JSX {
	type MaybePromise<T> = T | Promise<T>;
	type MaybeFunction<T> = T | (() => T);

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
	static readonly #void = new Set([
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
		"xml",
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

		// intrinsic element
		// faster to concatenate attributes than to yield them as separate chunks
		let opening = tag;

		for (const key in props) {
			// more memory efficient to skip children instead of destructuring and using ...rest
			if (key === "children") continue;

			const value = props[key];

			if (value === true) {
				// just put the key without the value
				opening += ` ${key}`;
			} else if (typeof value === "string") {
				opening += ` ${key}="${Render.escape(value, true)}"`;
			} else if (typeof value === "number" || typeof value === "bigint") {
				opening += ` ${key}="${value}"`;
			}
			// otherwise, don't include the attribute
		}

		if (tag === "html") {
			yield Render.html(`<!doctype html><${opening}>`);
		} else if (tag === "xml") {
			yield Render.html(`<?${opening}?>`);
		} else {
			yield Render.html(`<${opening}>`);
		}

		// if children and a void element, render it like normal
		// to account for cases like XML <link>content</link>
		// assumes the user knows what they are doing
		if (props.children == null && JSX.#void.has(tag)) return;

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
