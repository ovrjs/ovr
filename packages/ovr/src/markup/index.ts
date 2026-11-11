import type { JSX } from "../jsx/index.js";
import { Codec, Size } from "../util/index.js";

/** Chunk of a rendered element: text, or markup */
class Chunk {
	/** Text, or markup when `raw` */
	readonly value: string;

	/** `true` if the value is markup, which is not escaped */
	readonly raw: boolean | undefined;

	/**
	 * Chunk of a rendered element.
	 *
	 * @param value Text, escaped when it is rendered as markup
	 * @param raw Set to `true` if the value is safe markup that should not be escaped
	 */
	constructor(value: unknown, raw?: boolean) {
		this.value = String(value ?? "");
		this.raw = raw;
	}

	/**
	 * @returns Safe markup to render
	 */
	toString(): string {
		return this.raw ? this.value : Markup.escape(this.value);
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

	/** @returns The tag's markup, built when it is written */
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
				opening += ` ${key}="${Markup.escape(value, true)}"`;
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
		// `join` is several times slower for chunks than for strings
		let markup = "";
		for (const chunk of this.chunks) markup += chunk.toString();
		return markup;
	}
}

/**
 * HTML tags that do not require a closing tag.
 *
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Glossary/Void_element#self-closing_tags)
 */
const voids = new Set([
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
 * Element created by `jsx`, internal to ovr. A render reads its tag and props
 * instead of iterating it, which costs a promise for each chunk at every level
 * of the tree. Anything else can still iterate it as the generator of its
 * chunks.
 */
export class Element implements AsyncGenerator<Chunk, void, unknown> {
	/** Tag name, or component */
	readonly tag: string | ((props: any) => JSX.Element);

	/** Props */
	readonly props: JSX.Props;

	/** Rendered, or being rendered, which a generator is only once */
	#taken = false;

	/** Chunks for what iterates the element itself */
	#chunks?: AsyncGenerator<Chunk, void, unknown>;

	/**
	 * @param tag Tag name, or component
	 * @param props Props
	 */
	constructor(tag: string | ((props: any) => JSX.Element), props: JSX.Props) {
		this.tag = tag;
		this.props = props;
	}

	/** @returns `true` once, to the render that writes the element */
	take() {
		return !this.#taken && (this.#taken = true);
	}

	/**
	 * Generator of the element's chunks, empty if it was already rendered.
	 * Chunks, not strings, so a render it is part of keeps its tags and what
	 * is already escaped.
	 */
	get #generator(): AsyncGenerator<Chunk, void, unknown> {
		return (this.#chunks ??= (async function* (element) {
			const render = new Render(element, undefined);

			try {
				for (let result: Step; (result = render.step());) {
					if (result instanceof Chunk) yield result;
					else await result;
				}
			} finally {
				await render.close();
			}
			// a copy the render can take, since this one now counts as rendered
		})(this.take() ? new Element(this.tag, this.props) : null));
	}

	next() {
		return this.#generator.next();
	}

	return(value: void | PromiseLike<void>) {
		return this.#generator.return(value);
	}

	throw(error: unknown) {
		return this.#generator.throw(error);
	}

	[Symbol.asyncIterator]() {
		return this;
	}

	async [Symbol.asyncDispose]() {
		await this.return();
	}
}

/** Internal protocol for a render, to read the element a `Markup` renders. */
const source = Symbol("source");

/** One step of a render: a chunk, a wait before the next step, or nothing once it is done */
export type Step = Chunk | Promise<unknown> | undefined;

/** Iterator a render is reading, of a generator or anything async iterable */
type Sequence = {
	readonly iterator: Iterator<JSX.Element> | AsyncIterator<JSX.Element>;
	readonly async: boolean;
};

/**
 * Renders an element one chunk at a time, internal to ovr. A step is
 * synchronous unless the element has to be waited for, so nested elements cost
 * a loop instead of a generator and a promise for each chunk at every level.
 */
export class Render {
	/** Chunks rendered before the element is its parent's current child */
	queue: Chunk[] | undefined;

	/** Waiting, set by the parent of a child */
	waiting = false;

	/** Nothing more to render, set by the parent of a child */
	done = false;

	/** Element to render next */
	#element: unknown;

	/** `0` no element is next, `1` an element is, `2` the value of a promise is */
	#next: 0 | 1 | 2 = 1;

	/** Disables escaping, for content that is not markup */
	readonly #raw: boolean | undefined;

	/** What follows the element: end tags, and iterators and children in progress */
	#stack: (Tag | Sequence | Parallel)[] | undefined;

	/** The wait the last step returned, if it did */
	#wait: Promise<unknown> | undefined;

	/**
	 * @param element Element to render
	 * @param raw Set to `true` to disable escaping
	 */
	constructor(element: unknown, raw: boolean | undefined) {
		this.#element = element;
		this.#raw = raw;
	}

	/**
	 * @returns The next chunk, a promise to wait for before the next step, or
	 * `undefined` once the element is rendered
	 */
	step(): Step {
		this.#wait = undefined;

		for (;;) {
			if (this.#next) {
				let element = this.#element;
				const resolved = this.#next === 2;
				this.#next = 0;
				this.#element = undefined;

				if (!resolved) {
					// modifications
					// these are required to allow functions to be used as children
					// instead of creating a separate component to use them
					if (typeof element === "function") element = element();
					if (element instanceof Promise) {
						return (this.#wait = element.then((value: unknown) => {
							this.#element = value;
							this.#next = 2;
						}));
					}
				}

				// resolve based on type

				if (element == null || typeof element === "boolean" || element === "") {
					// should not render
					continue;
				}

				if (element instanceof Chunk) {
					// already escaped or raw
					return element;
				}

				if (typeof element === "object") {
					// an element is written as markup whatever the options, so one
					// in content that is not markup is iterated as it always was
					if (element instanceof Element && !this.#raw && element.take()) {
						const { tag, props } = element;

						if (typeof tag === "function") {
							// component or fragment
							this.#element = tag(props);
							this.#next = 1;
							continue;
						}

						// intrinsic element, its markup is only built if it is written

						// if children and a void element, render it like normal
						// to account for cases like XML <link>content</link>
						// assumes the user knows what they are doing
						const closed = props.children == null && voids.has(tag);

						if (!closed) {
							(this.#stack ??= []).push(new Tag(tag));
							this.#element = props.children;
							this.#next = 1;
						}

						return new Tag(tag, props, closed);
					}

					if (element instanceof Markup) {
						// its element, which its strings would be escaped as text
						this.#element = element[source];
						this.#next = 1;
						continue;
					}

					if (Symbol.asyncIterator in element) {
						// any async iterable - lazily resolve
						(this.#stack ??= []).push({
							iterator: (element as AsyncIterable<JSX.Element>)[
								Symbol.asyncIterator
							](),
							async: true,
						});
						continue;
					}

					if (Symbol.iterator in element) {
						(this.#stack ??= []).push(
							"next" in element
								? // sync generator - lazily resolve, avoids loading all in memory
									{
										iterator: (element as Iterable<JSX.Element>)[
											Symbol.iterator
										](),
										async: false,
									}
								: // other iterable - array, set, etc.
									new Parallel(element as Iterable<JSX.Element>, this.#raw),
						);
						continue;
					}
				}

				// primitive or other object
				return new Chunk(element, this.#raw);
			}

			const stack = this.#stack;
			const top = stack?.[stack.length - 1];

			if (!top) return;

			if (top instanceof Parallel) {
				// stays on the stack to be closed if it throws
				const result = top.step();

				if (!result) stack!.pop();
				else if (result instanceof Chunk) return result;
				else return (this.#wait = result);
			} else {
				// an iterator is off the stack while it is read, so one that
				// throws is not closed as well
				stack!.pop();

				if (top instanceof Tag) return top; // end tag

				if (top.async) {
					return (this.#wait = Promise.resolve(top.iterator.next()).then(
						(result) => {
							if (!result.done) {
								stack!.push(top);
								this.#element = result.value;
								this.#next = 1;
							}
						},
					));
				}

				const result = (top.iterator as Iterator<JSX.Element>).next();

				if (!result.done) {
					stack!.push(top);
					this.#element = result.value;
					this.#next = 1;
				}
			}
		}
	}

	/**
	 * Ends the iterators and children in progress, so a generator runs its
	 * `finally` block when the render fails or is not read to its end.
	 */
	async close() {
		try {
			// as `return` does for a generator: a step that is waiting first goes
			// on to its chunk, so a promise it reaches is not left to reject unhandled
			if (this.#wait) {
				await this.#wait;

				for (
					let result: Step;
					(result = this.step()) && !(result instanceof Chunk);
				)
					await result;
			}
		} catch {}

		for (let top; (top = this.#stack?.pop());) {
			try {
				if (top instanceof Parallel) await top.close();
				else if (!(top instanceof Tag)) await top.iterator.return?.();
			} catch {}
		}
	}
}

/**
 * Children of an array, or another iterable that is not a generator: rendered
 * at the same time, and yielded in order.
 */
class Parallel {
	/** Render of each child */
	readonly #children: Render[];

	/**
	 * Children after the current one that can step: not waiting, and not done.
	 * Only these are looked at as the others wait, so a list of many children
	 * that each wait costs no more for each one that resolves.
	 */
	readonly #idle: Render[] = [];

	/** Index of the child being yielded */
	#current = 0;

	/** A child failed */
	#failed = false;

	/** What the child failed with */
	#error: unknown;

	/** Closed, so no child goes on */
	#closed = false;

	/** Ends the wait for a child */
	#notify: (() => void) | undefined;

	/**
	 * @param elements Children
	 * @param raw Set to `true` to disable escaping
	 */
	constructor(elements: Iterable<JSX.Element>, raw: boolean | undefined) {
		this.#children = [];

		// each child starts before any is waited for
		for (const element of elements) {
			const child = new Render(element, raw);
			const chunk = this.#advance(child);

			if (chunk) child.queue = [chunk];
			if (this.#children.push(child) > 1 && !child.done && !child.waiting)
				this.#idle.push(child);
		}
	}

	/** @returns The next step of the children, in their order */
	step(): Step {
		for (;;) {
			if (this.#failed) throw this.#error;

			const child = this.#children[this.#current];

			if (!child) return;

			const chunks = child.queue;

			if (chunks) {
				child.queue = undefined;

				// the others go on as the current one is read, so whatever they
				// wait for has started before they are next
				this.#rest();

				// chunks are queued, never changed, the same chunk may be rendered again
				return chunks.length === 1 ? chunks[0] : new Group(chunks);
			}

			if (child.done) this.#current++;
			else if (child.waiting) return this.#wait(child);
			else {
				const chunk = this.#advance(child);

				if (chunk) {
					this.#rest();
					return chunk;
				}
			}
		}
	}

	/** Ends the children in progress. */
	close() {
		this.#closed = true;
		this.#wake();

		return Promise.allSettled(this.#children.map((child) => child.close()));
	}

	/**
	 * Steps a child once.
	 *
	 * @param child Child that is not waiting
	 * @returns The chunk, if it rendered one
	 */
	#advance(child: Render) {
		let result: Step;

		try {
			result = child.step();
		} catch (error) {
			return this.#fail(error);
		}

		if (result instanceof Chunk) return result;

		if (result) {
			child.waiting = true;
			result.then(
				() => {
					child.waiting = false;

					// a step goes on to its chunk without being asked again, so
					// whatever the child waits for next starts as soon as it can
					if (!this.#failed && !this.#closed) {
						const chunk = this.#advance(child);

						if (chunk) (child.queue ??= []).push(chunk);
						if (
							!child.done &&
							!child.waiting &&
							child !== this.#children[this.#current]
						)
							this.#idle.push(child);
					}

					this.#wake();
				},
				(error: unknown) => this.#fail(error),
			);
		} else child.done = true;
	}

	/**
	 * Steps each child after the current one that can step. Their chunks are
	 * queued until they are the current one.
	 *
	 * @returns `true` if a child stepped
	 */
	#rest() {
		const idle = this.#idle;

		if (!idle.length || this.#failed || this.#closed) return false;

		const current = this.#children[this.#current];
		let stepped = false;
		let kept = 0;

		for (let i = 0; i < idle.length; i++) {
			const child = idle[i]!;

			// the current child is stepped as it is read
			if (child !== current) {
				const chunk = this.#advance(child);

				if (chunk) (child.queue ??= []).push(chunk);
				// one that waits is added again once it can step
				if (!child.done && !child.waiting) idle[kept++] = child;
				stepped = true;
			}
		}

		idle.length = kept;

		return stepped;
	}

	/**
	 * Waits for the current child. The others go on meanwhile, a round of
	 * steps at a time, so the current one is next as soon as it can be.
	 *
	 * @param child Current child, which is waiting
	 */
	async #wait(child: Render) {
		while (child.waiting && !this.#failed && !this.#closed) {
			if (this.#rest()) await undefined;
			else await new Promise<void>((resolve) => (this.#notify = resolve));
		}
	}

	/** Ends the wait, if there is one, to look at the children again. */
	#wake() {
		const notify = this.#notify;
		this.#notify = undefined;
		notify?.();
	}

	/** @param error What a child failed with, the first is thrown */
	#fail(error: unknown) {
		if (!this.#failed) {
			this.#failed = true;
			this.#error = error;
		}

		this.#wake();
	}
}

/**
 * A render piped into a `ReadableStream`, internal to ovr.
 *
 * @param render Render of markup, or of text such as Markdown
 * @returns `ReadableStream` of what it renders
 */
export const readable = (render: {
	step(): Chunk | string | Promise<unknown> | undefined;
	close(): Promise<unknown>;
}) => {
	// `highWaterMark` defaults to 1
	// https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/ReadableStream#highwatermark
	// setting this ensures at least a small buffer is maintained if the
	// underlying server does not have its own high water mark set
	// https://blog.cloudflare.com/unpacking-cloudflare-workers-cpu-performance-benchmarks/#inefficient-streams-adapters
	// in Node, the default is 16kb, so this stacks another 2kb in front
	// https://nodejs.org/api/http.html#outgoingmessagewritablehighwatermark
	const highWaterMark = 2 * Size.kb;

	/** Wait a pull left for the next one, since it had text to send first */
	let wait: Promise<unknown> | undefined;

	/** Cancelled, so a pull that was waiting does not render more */
	let cancelled = false;

	return new ReadableStream<Uint8Array>(
		{
			// enables zero-copy transfer from underlying source when queue is empty
			// https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_byte_streams#overview
			type: "bytes",
			// `pull` ensures backpressure and cancelled requests stop the render
			async pull(c) {
				let text = "";
				let result: ReturnType<typeof render.step>;

				try {
					if (wait) {
						const last = wait;
						wait = undefined;
						await last;
					}

					// The stream pulls until its queue is full, and each chunk it is
					// given costs far more than rendering one. So what is rendered
					// without waiting is sent together, up to as much as the stream
					// would have pulled.
					while (!cancelled && (result = render.step())) {
						if (!(result instanceof Promise)) {
							text += result.toString();
							if (text.length >= highWaterMark) break;
						} else if (text) {
							// send what is rendered before waiting for more
							wait = result;
							// handled when it is awaited, by the next pull or the close
							result.catch(() => {});
							break;
						} else await result;
					}
				} catch (error) {
					await render.close();
					throw error;
				}

				if (cancelled) return;

				if (text) {
					c.enqueue(
						// need to encode for Node (ex: during prerendering) or it will error
						// doesn't seem to be needed for browsers
						// faster than piping through a `TextEncoderStream`
						Codec.encode(text),
					);
				}

				if (!result) c.close();
			},
			async cancel() {
				cancelled = true;
				await render.close();
			},
		},
		{ highWaterMark },
	);
};

export namespace Markup {
	/** Markup options */
	export type Options = {
		/** Set to `true` to disable escaping, for content that is not markup */
		raw?: boolean;
	};

	/** Rendered `Chunk` instance */
	export type Chunk = InstanceType<typeof Chunk>;
}

/**
 * Renders an element to markup, such as HTML, SVG, or XML, as an
 * `AsyncIterable` of strings, a stream, or a string. `Markdown` renders the
 * same elements to Markdown.
 */
export class Markup {
	/** Regex to find escape character for attributes */
	static readonly #attr = /[&"<]/g;

	/** Regex to find escape character for content */
	static readonly #content = /[&<]/g;

	/** Escape character map */
	static readonly #map = { "&": "&amp;", '"': "&quot;", "<": "&lt;" };

	/** Element to render */
	readonly #element: JSX.Element;

	/** Markup options */
	readonly #options: Markup.Options | undefined;

	/**
	 * Creates an `AsyncIterable` that renders the `Element`.
	 *
	 * @param element Element to render
	 * @param options Markup options
	 */
	constructor(element: JSX.Element, options?: Markup.Options) {
		this.#element = element;
		this.#options = options;
	}

	/** @returns The element, rendered in place where a `Markup` is a child */
	get [source]() {
		return this.#element;
	}

	/** @yields Markup as the `Element` resolves */
	async *[Symbol.asyncIterator](): AsyncGenerator<string, void, unknown> {
		const render = new Render(this.#element, this.#options?.raw);

		try {
			for (let result: Step; (result = render.step());) {
				if (result instanceof Chunk) yield result.toString();
				else await result;
			}
		} finally {
			await render.close();
		}
	}

	/**
	 * `render` piped into a `ReadableStream`.
	 * Use `render` when possible to avoid the overhead of the stream.
	 *
	 * @param element Element to render
	 * @param options Markup options
	 * @returns `ReadableStream` of markup
	 */
	static stream(element: JSX.Element, options?: Markup.Options) {
		return readable(new Render(element, options?.raw));
	}

	/**
	 * Converts a render into a fully concatenated string of markup.
	 *
	 * ### WARNING
	 *
	 * This negates streaming benefits and buffers the result into a string.
	 *
	 * @param element Element to render
	 * @param options Markup options
	 * @returns Concatenated markup
	 */
	static async string(element: JSX.Element, options?: Markup.Options) {
		const render = new Render(element, options?.raw);
		const chunks: Chunk[] = [];

		try {
			for (let result: Step; (result = render.step());) {
				if (result instanceof Chunk) chunks.push(result);
				else await result;
			}
		} finally {
			await render.close();
		}

		// written once every chunk is rendered, as a group of them is
		return new Group(chunks).toString();
	}

	/**
	 * Render raw markup and dangerously bypass escaping. It is written as it is
	 * in Markdown too, which can contain HTML.
	 *
	 * @param html Safe markup to render
	 * @returns New _safe_ `Chunk`
	 */
	static raw(html: unknown) {
		return new Chunk(html, true);
	}

	/**
	 * Escapes text for markup.
	 *
	 * @param html String to escape
	 * @param attr Set to `true` if the value is an attribute, otherwise it is content
	 * @returns Escaped text
	 */
	static escape(html: string, attr?: boolean) {
		return html.replace(
			attr ? Markup.#attr : Markup.#content,
			(c) =>
				// @ts-expect-error - private method type error
				Markup.#map[c],
		);
	}
}
