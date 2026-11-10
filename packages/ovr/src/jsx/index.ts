import { Element, type Markup } from "../markup/index.js";
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
	 * The main function of the JSX transform cycle, each time JSX is encountered
	 * it is passed into `jsx` to be resolved.
	 *
	 * @template P Props of the element or component
	 * @param tag tag name or function component
	 * @param props object containing all the properties and attributes passed to the element or component
	 * @returns Generator of the element's `Chunk`s of HTML
	 */
	static jsx<P extends JSX.Props = JSX.Props>(
		tag: ((props: P) => JSX.Element) | string,
		props: P,
	): AsyncGenerator<Markup.Chunk, void, unknown> {
		// this function doesn't need to be called recursively
		// JSX will be transformed into `jsx()` function calls automatically

		// a component is called, and an element's markup built, when it is rendered
		return new Element(tag, props);
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
