import type { JSX } from "../jsx/index.js";
import {
	Blocks,
	type Options as MarkdownOptions,
	escape as markdown,
} from "../markdown/index.js";
import {
	Chunk as ChunkClass,
	Group,
	Renderer,
	Source,
	type Step,
	escape as markup,
	readable,
	source,
} from "../markup/index.js";

export namespace Render {
	/** A piece of a render, an interface so declaration files name it */
	export interface Chunk extends ChunkClass {}

	export namespace Options {
		/** Options of a render of markup */
		export type Markup = {
			/** Set to `true` to disable escaping, for content that is not markup */
			raw?: boolean;
		};

		/** Options of a render of Markdown */
		export type Markdown = MarkdownOptions;
	}

	/** Text to escape, by where it goes: one of them */
	export type Escape =
		| {
				/** Text for an element's content */
				readonly markup: string;
				readonly attr?: never;
				readonly markdown?: never;
		  }
		| {
				/** Text for an attribute's value */
				readonly attr: string;
				readonly markup?: never;
				readonly markdown?: never;
		  }
		| {
				/** Text for Markdown */
				readonly markdown: string;
				readonly markup?: never;
				readonly attr?: never;
		  };

	/**
	 * What is written as it is, for people, agents, or both. With only
	 * `markup`, agents get the markup too, which Markdown can contain.
	 */
	export type Raw =
		| {
				/** Safe markup the page shows */
				readonly markup: unknown;
				/** What agents reading the page as Markdown get in its place, empty for nothing */
				readonly markdown?: unknown;
		  }
		| {
				/** Safe markup the page shows, nothing when left out */
				readonly markup?: unknown;
				/** What agents reading the page as Markdown get */
				readonly markdown: unknown;
		  };
}

/**
 * A render of an element, to markup such as HTML for browsers or to Markdown
 * for agents: an `AsyncIterable` of strings, a stream, or a string. Its
 * static methods write what is already rendered as it is.
 *
 * ```tsx
 * const html = await new Render({ markup: <Page /> }).string();
 * const markdown = await new Render({ markdown: <Page /> }).string();
 *
 * for await (const chunk of new Render({ markup: <Page /> })) {
 * 	// each string as the element resolves
 * }
 * ```
 */
export class Render {
	/** Element to render */
	readonly #element: JSX.Element;

	/** Rendered to Markdown, otherwise to markup */
	readonly #markdown: boolean;

	/** Options of either */
	readonly #options:
		(Render.Options.Markup & Render.Options.Markdown) | undefined;

	/**
	 * @param element The element, by what to render it to: `markup`, such as
	 * HTML, SVG, or XML
	 * @param options Markup options
	 */
	constructor(
		element: { readonly markup: JSX.Element },
		options?: Render.Options.Markup,
	);
	/**
	 * @param element The element, by what to render it to: `markdown`, as
	 * agents that ask for it read a page. Each top level block is written as
	 * soon as it closes, and when the page has a `<main>` element, only its
	 * contents are kept
	 * @param options Markdown options
	 */
	constructor(
		element: { readonly markdown: JSX.Element },
		options?: Render.Options.Markdown,
	);
	constructor(
		element:
			{ readonly markup: JSX.Element } | { readonly markdown: JSX.Element },
		options?: Render.Options.Markup & Render.Options.Markdown,
	) {
		this.#markdown = "markdown" in element;
		this.#element = "markdown" in element ? element.markdown : element.markup;
		this.#options = options;
	}

	/** @returns The element, rendered in place where a render is a child */
	get [source]() {
		return this.#element;
	}

	/** @returns What renders the element a step at a time, Markdown a block at a time */
	#steps() {
		return this.#markdown
			? new Blocks(this.#element, this.#options)
			: new Renderer(this.#element, this.#options?.raw);
	}

	/** @yields Strings of the render, as the element resolves */
	async *[Symbol.asyncIterator](): AsyncGenerator<string, void, unknown> {
		const steps = this.#steps();

		try {
			for (let result: Step | string; (result = steps.step());) {
				if (typeof result === "string") yield result;
				else if (result instanceof ChunkClass) yield result.toString();
				else await result;
			}
		} finally {
			await steps.close();
		}
	}

	/**
	 * The render piped into a `ReadableStream`. Iterate it when possible, to
	 * avoid the overhead of the stream.
	 *
	 * @returns `ReadableStream` of the render
	 */
	stream() {
		return readable(this.#steps());
	}

	/**
	 * The whole render as one string, which buffers it and gives up the
	 * benefits of streaming.
	 *
	 * @returns The render, concatenated
	 */
	async string() {
		const steps = this.#steps();
		const chunks: ChunkClass[] = [];
		let text = "";

		try {
			for (let result: Step | string; (result = steps.step());) {
				if (typeof result === "string") text += result;
				else if (result instanceof ChunkClass) chunks.push(result);
				else await result;
			}
		} finally {
			await steps.close();
		}

		// markup is written once every chunk is rendered, as a group of them is
		return this.#markdown ? text : new Group(chunks).toString();
	}

	/**
	 * Writes markup, Markdown, or both as they are, dangerously bypassing
	 * escaping, so both must be safe.
	 *
	 * ```tsx
	 * Render.raw({ markup: icon }); // the page and agents get the markup
	 * Render.raw({ markup: render(steps), markdown: steps }); // each its own
	 * Render.raw({ markdown: " · " }); // only agents
	 * Render.raw({ markup: button, markdown: "" }); // only the page
	 * ```
	 *
	 * @param raw Safe markup for the page, and what agents get in its place
	 * @returns New _safe_ chunk
	 */
	static raw(raw: Render.Raw): Render.Chunk {
		return raw.markdown === undefined
			? new ChunkClass(raw.markup, true)
			: new Source(raw.markdown, raw.markup);
	}

	/**
	 * Escapes text, as a render does, to put in markup or Markdown you write
	 * yourself, such as what `Render.raw` is given.
	 *
	 * ```ts
	 * Render.escape({ markup: "a < b" }); // "a &lt; b"
	 * Render.escape({ attr: 'say "hi"' }); // "say &quot;hi&quot;"
	 * Render.escape({ markdown: "2 * 3" }); // "2 \\* 3"
	 * ```
	 *
	 * @param text Text to escape, by where it goes: `markup` for an element's
	 * content, `attr` for an attribute's value, or `markdown`
	 * @returns Escaped text
	 */
	static escape(text: Render.Escape) {
		return text.markdown !== undefined
			? markdown(text.markdown)
			: text.attr !== undefined
				? markup(text.attr, true)
				: markup(text.markup);
	}
}
