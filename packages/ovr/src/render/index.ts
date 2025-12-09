import type { JSX } from "../jsx/index.js";
import { Codec } from "../util/index.js";

type Next = { i: number; result: IteratorResult<Chunk, void> };

/** Chunk containing the HTML from a rendered element */
class Chunk {
	/** Safe value to render */
	#value: string;

	/**
	 * Chunk containing the HTML from a rendered element.
	 *
	 * @param html string of HTML to escape
	 * @param safe Set to `true` if the HTML is safe and should not be escaped
	 */
	constructor(html: unknown, safe?: boolean) {
		const value = String(html ?? "");
		this.#value = safe ? value : Render.escape(value);
	}

	/**
	 * @returns Safe value to render
	 */
	toString() {
		return this.#value;
	}

	/**
	 * @param chunk Chunk to append to the end of the chunk
	 */
	concat(chunk: Chunk) {
		this.#value += chunk;
	}
}

export namespace Render {
	/** Render options */
	export type Options = {
		/** Set to `true` to disable escaping for non-HTML use */
		safe?: boolean;
	};

	/** Rendered `Chunk` instance */
	export type Chunk = InstanceType<typeof Chunk>;
}

export class Render {
	/** Regex to find escape character for HTML attributes */
	static readonly #attr = /[&"<]/g;

	/** Regex to find escape character for HTML content */
	static readonly #content = /[&<]/g;

	/** Escape character map */
	static readonly #map = { "&": "&amp;", '"': "&quot;", "<": "&lt;" };

	/** Element to render */
	readonly #element: JSX.Element;

	/** Render options */
	readonly #options?: Render.Options;

	/**
	 * Creates an `AsyncIterable` that renders the `Element`.
	 *
	 * @param element Element to render
	 * @param options Render options
	 */
	constructor(element: JSX.Element, options?: Render.Options) {
		this.#element = element;
		this.#options = options;
	}

	/** @yields `Chunk`s as the `Element` resolves */
	async *[Symbol.asyncIterator](): AsyncGenerator<Chunk, void, unknown> {
		let element = this.#element;

		// modifications
		// these are required to allow functions to be used as children
		// instead of creating a separate component to use them
		if (typeof element === "function") element = element();
		if (element instanceof Promise) element = await element;

		// resolve based on type
		// should not render
		if (element == null || typeof element === "boolean" || element === "")
			return;

		if (element instanceof Chunk) {
			// already escaped or safe
			yield element;
			return;
		}

		if (typeof element === "object") {
			if (Symbol.asyncIterator in element) {
				// any async iterable - lazily resolve
				for await (const children of element)
					yield* new Render(children, this.#options);
				return;
			}

			if (Symbol.iterator in element) {
				// sync iterable
				if ("next" in element) {
					// sync generator - lazily resolve, avoids loading all in memory
					for (const children of element)
						yield* new Render(children, this.#options);
					return;
				}

				// other iterable - array, set, etc.
				// process children in parallel
				const renders = Array.from(
					element,
					(el) => new Render(el, this.#options),
				);
				const n = renders.length;
				const queue = new Array<Chunk | null>(n);
				const complete = new Uint8Array(n);
				let current = 0;

				for await (const m of Render.#merge(renders)) {
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
		yield new Chunk(element, this.#options?.safe);
	}

	/**
	 * `render` piped into a `ReadableStream`.
	 * Use `render` when possible to avoid the overhead of the stream.
	 *
	 * @param element Element to render
	 * @param options Render options
	 * @returns `ReadableStream` of HTML
	 */
	static stream(element: JSX.Element, options?: Render.Options) {
		const gen = new Render(element, options)[Symbol.asyncIterator]();

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
						Codec.encode(String(result.value)),
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
	}

	/**
	 * Converts a render into a fully concatenated string of HTML.
	 *
	 * ### WARNING
	 *
	 * This negates streaming benefits and buffers the result into a string.
	 * @param element Element to render
	 * @param options Render options
	 * @returns Concatenated HTML
	 */
	async string(element: JSX.Element, options?: Render.Options) {
		return (await Array.fromAsync(new Render(element, options))).join("");
	}

	/**
	 * Render raw HTML and dangerously bypass escaping.
	 *
	 * @param html Safe html to render
	 * @returns New _safe_ `Chunk`
	 */
	static html(html: unknown) {
		return new Chunk(html, true);
	}

	/**
	 * Escapes strings of HTML.
	 *
	 * @param html String to escape
	 * @param attr Set to `true` if the value is an attribute, otherwise it's a string of HTML content
	 * @returns Escaped string of HTML
	 */
	static escape(html: string, attr?: boolean) {
		return html.replace(
			attr ? Render.#attr : Render.#content,
			(c) =>
				// @ts-expect-error - private method type error
				Render.#map[c],
		);
	}

	/**
	 * @param gen
	 * @param i index of the generator within the list
	 * @returns promise containing the index and the next result of the iteration
	 */
	static async #next(
		gen: AsyncGenerator<Chunk, void, unknown>,
		i: number,
	): Promise<Next> {
		return { i, result: await gen.next() };
	}

	/**
	 * Merges `Render[]` into a single `AsyncGenerator`, resolving all in parallel.
	 * The return of each `Render` is yielded from the generator with `done: true`.
	 *
	 * Adapted from [stack overflow answers](https://stackoverflow.com/questions/50585456).
	 *
	 * @param renders Resolved in parallel.
	 * @yields `NextResult` and index of the resolved generator.
	 */
	static async *#merge(renders: Render[]) {
		const generators = renders.map((render) => render[Symbol.asyncIterator]());
		const promises = new Map<number, Promise<Next>>();

		for (let i = 0; i < generators.length; i++) {
			promises.set(i, Render.#next(generators[i]!, i));
		}

		let next: Next;

		try {
			while (promises.size > 0) {
				yield (next = await Promise.race(promises.values()));

				if (next.result.done) {
					promises.delete(next.i);
				} else {
					promises.set(next.i, Render.#next(generators[next.i]!, next.i));
				}
			}
		} finally {
			for (const gen of generators) {
				try {
					gen.return();
				} catch {
					// could have already returned
				}
			}
		}
	}
}
