import { Html, Tag } from "../html/index.js";
import type { IntrinsicElements as IE } from "./elements.js";

export namespace JSX {
	/**
	 * `T`, or a promise of it.
	 *
	 * @template T Value
	 */
	type MaybePromise<T> = T | Promise<T>;
	/**
	 * `T`, or a function returning it.
	 *
	 * @template T Value
	 */
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
	 * @template P Props of the element or component
	 * @param tag tag name or function component
	 * @param props object containing all the properties and attributes passed to the element or component
	 * @yields `Chunk`s of HTML
	 */
	static async *jsx<P extends JSX.Props = JSX.Props>(
		tag: ((props: P) => JSX.Element) | string,
		props: P,
	): AsyncGenerator<Html.Chunk, void, unknown> {
		// this function doesn't need to be called recursively
		// JSX will be transformed into `jsx()` function calls automatically

		if (typeof tag === "function") {
			// component or fragment
			yield* new Html(tag(props));
			return;
		}

		// intrinsic element, its HTML is only built if it is written as HTML

		// if children and a void element, render it like normal
		// to account for cases like XML <link>content</link>
		// assumes the user knows what they are doing
		const closed = props.children == null && JSX.#void.has(tag);

		yield new Tag(tag, props, closed);

		if (closed) return;

		yield* new Html(props.children);

		yield new Tag(tag);
	}

	/**
	 * JSX requires a `Fragment` export to resolve `<></>`
	 *
	 * @param props containing `children` to render
	 * @returns children to render
	 */
	static Fragment(props: { children?: JSX.Element }) {
		return props.children;
	}
}

export const { jsx, Fragment } = JSX;
