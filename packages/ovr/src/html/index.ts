import type { JSX } from "../jsx/index.js";
import { Codec, Size } from "../util/index.js";

/** Completed generator read */
type Read = {
	/** Index of the generator within the merged list */
	i: number;

	/** Result returned by the generator */
	result: IteratorResult<Chunk, void>;
};

/** Chunk of a rendered element: text, or HTML */
class Chunk {
	/** Text, or HTML when `safe` */
	readonly value: string;

	/** `true` if the value is HTML, which is not escaped */
	readonly safe: boolean | undefined;

	/**
	 * Chunk of a rendered element.
	 *
	 * @param value Text, escaped when it is rendered as HTML
	 * @param safe Set to `true` if the value is safe HTML that should not be escaped
	 */
	constructor(value: unknown, safe?: boolean) {
		this.value = String(value ?? "");
		this.safe = safe;
	}

	/**
	 * @returns Safe HTML to render
	 */
	toString(): string {
		return this.safe ? this.value : Html.escape(this.value);
	}
}

/**
 * Start or end tag of an element, internal to ovr. It keeps the element's
 * name and props, so the render can also be written as Markdown.
 */
export class Tag extends Chunk {
	/** Tag name */
	readonly name: string;

	/** Props of a start tag, `undefined` for an end tag */
	readonly props: JSX.Props | undefined;

	/** `true` for a start tag without an end tag, such as `<input>` */
	readonly closed: boolean | undefined;

	/**
	 * @param name Tag name
	 * @param props Props of a start tag
	 * @param closed The element has no end tag
	 */
	constructor(name: string, props?: JSX.Props, closed?: boolean) {
		super("", true);
		this.name = name;
		this.props = props;
		this.closed = closed;
	}

	/** @returns The tag's HTML, built when it is written */
	override toString() {
		const { name, props } = this;
		if (!props) return `</${name}>`;

		// faster to concatenate attributes than to yield them as separate chunks
		let opening = name;

		for (const key in props) {
			// more memory efficient to skip children instead of destructuring and using ...rest
			if (key === "children") continue;

			const value = props[key];

			if (value === true) {
				// just put the key without the value
				opening += ` ${key}`;
			} else if (typeof value === "string") {
				opening += ` ${key}="${Html.escape(value, true)}"`;
			} else if (typeof value === "number" || typeof value === "bigint") {
				opening += ` ${key}="${value}"`;
			}
			// otherwise, don't include the attribute
		}

		return name === "html"
			? `<!doctype html><${opening}>`
			: name === "xml"
				? `<?${opening}?>`
				: `<${opening}>`;
	}
}

/**
 * Chunks a later sibling rendered while an earlier one was still rendering,
 * yielded together once they are next. Internal to ovr.
 */
export class Group extends Chunk {
	/** Chunks in order */
	readonly chunks: Chunk[];

	/** @param chunks Chunks in order */
	constructor(chunks: Chunk[]) {
		super("", true);
		this.chunks = chunks;
	}

	override toString() {
		return this.chunks.join("");
	}
}

export namespace Html {
	/** HTML options */
	export type Options = {
		/** Set to `true` to disable escaping for non-HTML use */
		safe?: boolean;
	};

	/** Rendered `Chunk` instance */
	export type Chunk = InstanceType<typeof Chunk>;
}

/**
 * Renders an element to HTML, as an `AsyncIterable` of chunks, a stream, or a
 * string. `Markdown` renders the same elements to Markdown.
 */
export class Html {
	/** Regex to find escape character for HTML attributes */
	static readonly #attr = /[&"<]/g;

	/** Regex to find escape character for HTML content */
	static readonly #content = /[&<]/g;

	/** Escape character map */
	static readonly #map = { "&": "&amp;", '"': "&quot;", "<": "&lt;" };

	/** Element to render */
	readonly #element: JSX.Element;

	/** HTML options */
	readonly #options: Html.Options | undefined;

	/**
	 * Creates an `AsyncIterable` that renders the `Element`.
	 *
	 * @param element Element to render
	 * @param options HTML options
	 */
	constructor(element: JSX.Element, options?: Html.Options) {
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

		if (element == null || typeof element === "boolean" || element === "") {
			// should not render
			return;
		}

		if (element instanceof Chunk) {
			// already escaped or safe
			yield element;
			return;
		}

		if (typeof element === "object") {
			if (Symbol.asyncIterator in element) {
				// any async iterable - lazily resolve
				for await (const children of element) {
					if (children instanceof Chunk) yield children;
					else yield* new Html(children, this.#options);
				}
				return;
			}

			if (Symbol.iterator in element) {
				// sync iterable
				if ("next" in element) {
					// sync generator - lazily resolve, avoids loading all in memory
					for (const children of element) {
						if (children instanceof Chunk) yield children;
						else yield* new Html(children, this.#options);
					}
					return;
				}

				// other iterable - array, set, etc.
				// process children in parallel
				const renders = Array.from(
					element,
					(el) => new Html(el, this.#options),
				);
				const n = renders.length;
				// chunks are queued, never changed, the same chunk may be rendered again
				const queue = new Array<Chunk[] | null>(n);
				const queued = (i: number) => {
					const chunks = queue[i]!;
					queue[i] = null;
					return chunks.length === 1 ? chunks[0]! : new Group(chunks);
				};
				const complete = new Uint8Array(n);
				let current = 0;

				for await (const m of Html.#merge(renders)) {
					if (m.result.done) {
						complete[m.i] = 1;

						if (m.i === current) {
							while (++current < n) {
								// yield whatever is in the next queue even if it hasn't completed yet
								if (queue[current]) yield queued(current);

								// if it hasn't completed, stop iterating to the next
								if (!complete[current]) break;
							}
						}
					} else if (m.i === current) {
						yield m.result.value; // stream the current value directly
					} else {
						// queue the value for later
						(queue[m.i] ??= []).push(m.result.value);
					}
				}

				// clear the queue
				for (let i = 0; i < n; i++) if (queue[i]) yield queued(i);
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
	 * @param options HTML options
	 * @returns `ReadableStream` of HTML
	 */
	static stream(element: JSX.Element, options?: Html.Options) {
		return Html.#readable(new Html(element, options)[Symbol.asyncIterator]());
	}

	/**
	 * @param gen Generator of chunks to stream
	 * @returns `ReadableStream` that pulls from the generator
	 */
	static #readable(gen: AsyncGenerator<unknown, void, unknown>) {
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
						return;
					}

					c.enqueue(
						// need to encode for Node (ex: during prerendering) or it will error
						// doesn't seem to be needed for browsers
						// faster than piping through a `TextEncoderStream`
						Codec.encode(String(result.value)),
					);
				},
				async cancel() {
					await gen.return();
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
				highWaterMark: 2 * Size.kb,
			},
		);
	}

	/**
	 * Converts a render into a fully concatenated string of HTML.
	 *
	 * ### WARNING
	 *
	 * This negates streaming benefits and buffers the result into a string.
	 *
	 * @param element Element to render
	 * @param options HTML options
	 * @returns Concatenated HTML
	 */
	static async string(element: JSX.Element, options?: Html.Options) {
		return (await Array.fromAsync(new Html(element, options))).join("");
	}

	/**
	 * Render raw HTML and dangerously bypass escaping. It is written as it is
	 * in Markdown too, which can contain HTML.
	 *
	 * @param html Safe html to render
	 * @returns New _safe_ `Chunk`
	 */
	static raw(html: unknown) {
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
			attr ? Html.#attr : Html.#content,
			(c) =>
				// @ts-expect-error - private method type error
				Html.#map[c],
		);
	}

	/**
	 * Merges renders into a single `AsyncGenerator`, resolving all in parallel.
	 * The return of each render is yielded from the generator with `done: true`.
	 *
	 * @param renders Resolved in parallel.
	 * @yields Iteration result and index of the resolved generator.
	 */
	static async *#merge(renders: Html[]) {
		const generators = renders.map((render) => render[Symbol.asyncIterator]());
		const ready: Read[] = [];
		let cursor = 0;
		let active = generators.length;
		let notify: (() => void) | undefined;
		let error: unknown;
		let failed = false;
		let value: Read;

		// keep one read in flight per generator
		const next = (i: number) => {
			generators[i]!.next().then(
				(result) => {
					ready.push({ i, result });
					notify?.();
					notify = undefined;
				},
				(reason) => {
					if (!failed) error = reason;
					failed = true;
					notify?.();
					notify = undefined;
				},
			);
		};

		try {
			for (let i = 0; i < active; i++) next(i);

			while (active) {
				if (cursor === ready.length) {
					ready.length = cursor = 0;
					if (!failed) await new Promise<void>((resolve) => (notify = resolve));
				}

				if (failed) throw error;

				yield (value = ready[cursor++]!);

				if (value.result.done) active--;
				else next(value.i);
			}
		} finally {
			if (active) {
				await Promise.allSettled(generators.map((gen) => gen.return()));
			}
		}
	}
}
