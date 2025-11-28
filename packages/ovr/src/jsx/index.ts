import { Chunk } from "../chunk/index.js";
import type { MaybeFunction, MaybePromise } from "../types/index.js";
import { encoder } from "../util/encoder.js";
import type { IntrinsicElements as IE } from "./elements.js";
import { merge } from "./merge.js";

/** ovr JSX namespace */
export namespace JSX {
	/** Standard HTML elements */
	export interface IntrinsicElements extends IE {}

	/** ovr JSX Element */
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
}

/** Unknown component props */
export type Props = Record<string, JSX.Element>;

/**
 * These are the HTML tags that do not require a closing tag.
 *
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Glossary/Void_element#self-closing_tags)
 */
const voidElements = new Set([
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
export async function* jsx<P extends Props = Props>(
	tag: ((props: P) => JSX.Element) | string,
	props: P,
) {
	// this function doesn't need to be called recursively
	// JSX will be transformed into `jsx()` function calls automatically

	if (typeof tag === "function") {
		// component or fragment
		yield* render(tag(props));
		return;
	}

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
			attributes += ` ${key}="${Chunk.escape(value, true)}"`;
		} else if (typeof value === "number" || typeof value === "bigint") {
			attributes += ` ${key}="${value}"`;
		}
		// otherwise, don't include the attribute
	}

	if (tag === "html") yield Chunk.safe("<!doctype html>");

	yield Chunk.safe(`<${tag}${attributes}>`);

	if (voidElements.has(tag)) return;

	yield* render(props.children);

	yield Chunk.safe(`</${tag}>`);
}

/**
 * JSX requires a `Fragment` export to resolve `<></>`
 *
 * @param props containing `children` to render
 * @yields concatenated children
 */
export async function* Fragment(props: { children?: JSX.Element }) {
	yield* render(props.children);
}

export namespace render {
	/** Rendering options */
	export type Options = {
		/** Set to `true` to disable escaping for non-HTML use */
		safe?: boolean;
	};
}

/**
 * Creates an `AsyncGenerator` that renders the `Element`.
 *
 * @param element
 * @param options
 * @yields `Chunk`s of HTML as the `Element` resolves
 */
export const render: {
	(
		element: JSX.Element,
		options?: render.Options,
	): AsyncGenerator<Chunk, void, unknown>;

	/**
	 * `render` piped into a `ReadableStream`.
	 * Use `render` when possible to avoid the overhead of the stream.
	 *
	 * @param element
	 * @param options
	 * @returns `ReadableStream` of HTML
	 */
	stream(element: JSX.Element, options?: render.Options): ReadableStream;

	/**
	 * Converts a `JSX.Element` into a fully concatenated string of HTML.
	 *
	 * ### WARNING
	 *
	 * This negates streaming benefits and buffers the result into a string.
	 * Use `render` whenever possible.
	 *
	 * @param element
	 * @param options
	 * @returns Concatenated HTML
	 */
	string(element: JSX.Element, options?: render.Options): Promise<string>;
} = async function* (element, options = {}) {
	// modifications
	// these are required to allow functions to be used as children
	// instead of creating a separate component to use them
	if (typeof element === "function") element = element();
	if (element instanceof Promise) element = await element;

	// resolve based on type
	// should not render
	if (element == null || typeof element === "boolean" || element === "") return;

	if (element instanceof Chunk) {
		// already escaped or safe
		yield element;
		return;
	}

	if (typeof element === "object") {
		if (Symbol.asyncIterator in element) {
			// any async iterable - lazily resolve
			for await (const children of element) yield* render(children, options);
			return;
		}

		if (Symbol.iterator in element) {
			// sync iterable
			if ("next" in element) {
				// sync generator - lazily resolve, avoids loading all in memory
				for (const children of element) yield* render(children, options);
				return;
			}

			// other iterable - array, set, etc.
			// process children in parallel
			const generators = Array.from(element, (el) => render(el, options));
			const n = generators.length;
			const queue = new Array<Chunk | null>(n);
			const complete = new Uint8Array(n);
			let current = 0;

			for await (const m of merge(generators)) {
				if (m.result.done) {
					complete[m.i] = 1;

					if (m.i === current) {
						while (++current < n) {
							if (queue[current]) {
								// yield whatever is in the next queue even if it hasn't completed yet
								yield queue[current]!;
								queue[current] = null;
							}

							// if it hasn't completed, stop iterating to the next
							if (!complete[current]) break;
						}
					}
				} else if (m.i === current) {
					yield m.result.value; // stream the current value directly
				} else {
					// queue the value for later
					if (queue[m.i]) queue[m.i]!.concat(m.result.value);
					else queue[m.i] = m.result.value;
				}
			}

			// clear the queue
			yield* queue.filter((chunk) => chunk !== null);
			return;
		}
	}

	// primitive or other object
	yield new Chunk(element, options.safe);
};

render.string = async (element: JSX.Element, options = {}) =>
	(await Array.fromAsync(render(element, options))).join("");

render.stream = (element: JSX.Element, options = {}) => {
	const gen = render(element, options);

	return new ReadableStream<Uint8Array>(
		{
			// enables zero-copy transfer from underlying source when queue is empty
			// https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_byte_streams#overview
			type: "bytes",
			// `pull` ensures backpressure and cancelled requests stop the generator
			async pull(c) {
				const result = await gen.next();

				if (result.done) {
					c.close();
					gen.return();
					return;
				}

				c.enqueue(
					// need to encode for Node (ex: during prerendering) or it will error
					// doesn't seem to be needed for browsers
					// faster than piping through a `TextEncoderStream`
					encoder.encode(result.value.value),
				);
			},
			cancel() {
				gen.return();
			},
		},
		{
			// `highWaterMark` defaults to 1
			// https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/ReadableStream#highwatermark
			// setting this ensures at least a small buffer is maintained if the
			// underlying server does not have its own high water mark set
			// https://blog.cloudflare.com/unpacking-cloudflare-workers-cpu-performance-benchmarks/#inefficient-streams-adapters
			// in Node, the default is 16kb, so this stacks another 2kb in front
			// https://nodejs.org/api/http.html#outgoingmessagewritablehighwatermark
			highWaterMark: 2048,
		},
	);
};
