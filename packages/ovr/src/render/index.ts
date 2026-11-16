import type { JSX } from "../jsx/index.js";
import { Markdown as MarkdownRender } from "../markdown/index.js";
import {
	Chunk as ChunkClass,
	Markup as MarkupRender,
	Source,
} from "../markup/index.js";

export namespace Render {
	/** A piece of a render, an interface so declaration files name it */
	export interface Chunk extends ChunkClass {}

	/** A render of markup: an `AsyncIterable` of strings, a stream, or a string */
	export interface Markup extends MarkupRender {}

	export namespace Markup {
		/** Markup options */
		export type Options = MarkupRender.Options;
	}

	/** A render of Markdown: an `AsyncIterable` of strings, a stream, or a string */
	export interface Markdown extends MarkdownRender {}

	export namespace Markdown {
		/** Markdown options */
		export type Options = MarkdownRender.Options;
	}

	/**
	 * What is written as it is, for people, agents, or both. With only
	 * `html`, agents get the HTML too, which Markdown can contain.
	 */
	export type Raw =
		| {
				/** Safe markup the page shows */
				readonly html: unknown;
				/** What agents reading the page as Markdown get in its place, empty for nothing */
				readonly markdown?: unknown;
		  }
		| {
				/** Safe markup the page shows, nothing when left out */
				readonly html?: unknown;
				/** What agents reading the page as Markdown get */
				readonly markdown: unknown;
		  };
}

/**
 * Renders elements, to markup such as HTML for browsers and to Markdown for
 * agents, and writes what is already rendered as it is.
 *
 * ```tsx
 * const html = await Render.markup(<Page />).string();
 * const markdown = await Render.markdown(<Page />).string();
 * ```
 */
export class Render {
	/**
	 * Writes markup, Markdown, or both as they are, dangerously bypassing
	 * escaping, so both must be safe.
	 *
	 * ```tsx
	 * Render.raw({ html: icon }); // the page and agents get the markup
	 * Render.raw({ html: render(steps), markdown: steps }); // each its own
	 * Render.raw({ markdown: " · " }); // only agents
	 * Render.raw({ html: button, markdown: "" }); // only the page
	 * ```
	 *
	 * @param raw Safe markup for the page, and what agents get in its place
	 * @returns New _safe_ chunk
	 */
	static raw(raw: Render.Raw): Render.Chunk {
		return raw.markdown === undefined
			? new ChunkClass(raw.html, true)
			: new Source(raw.markdown, raw.html);
	}

	/**
	 * Escapes text for markup.
	 *
	 * @param text Text to escape
	 * @param attr Set to `true` if the value is an attribute, otherwise it is content
	 * @returns Escaped text
	 */
	static escape(text: string, attr?: boolean) {
		return MarkupRender.escape(text, attr);
	}

	/**
	 * Renders an element to markup, such as HTML, SVG, or XML.
	 *
	 * ```tsx
	 * for await (const chunk of Render.markup(<Page />)) {
	 * 	// each string as the element resolves
	 * }
	 * ```
	 *
	 * @param element Element to render
	 * @param options Markup options
	 * @returns The render, to iterate, `stream()`, or `string()`
	 */
	static markup(
		element: JSX.Element,
		options?: Render.Markup.Options,
	): Render.Markup {
		return new MarkupRender(element, options);
	}

	/**
	 * Renders an element to Markdown, as agents that ask for it read a page.
	 * Each top level block is written as soon as it closes, and when the page
	 * has a `<main>` element, only its contents are kept.
	 *
	 * @param element Element to render
	 * @param options Markdown options
	 * @returns The render, to iterate, `stream()`, or `string()`
	 */
	static markdown(
		element: JSX.Element,
		options?: Render.Markdown.Options,
	): Render.Markdown {
		return new MarkdownRender(element, options);
	}
}
