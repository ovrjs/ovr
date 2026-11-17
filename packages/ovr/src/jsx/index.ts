import type { Context as View } from "../context/read.js";
import { type Chunk, Element } from "../markup/index.js";
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

	/**
	 * A component: a function of its props, and the context of the request
	 * it is rendered for. Use it to take a component as a value, such as a
	 * prop that is one. A component that takes only props fits it too.
	 *
	 * ```tsx
	 * function Card(props: { icon: JSX.Component<{ size: number }> }) {
	 * 	return <props.icon size={16} />;
	 * }
	 * ```
	 *
	 * @template P Props of the component
	 */
	export type Component<P = {}> = (props: P, c: View) => JSX.Element;

	/**
	 * What a tag can be: an element's name, or a component, which is a
	 * function of its props and the context of the request it is rendered
	 * for. A class is not one, so `<Form />` with the `Form` class is a type
	 * error instead of failing as it renders.
	 */
	export type ElementType = string | ((props: any, c: View<any>) => unknown);
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
		tag: ((props: P, c: View<any>) => JSX.Element) | string,
		props: P,
	): AsyncGenerator<Chunk, void, unknown> {
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
