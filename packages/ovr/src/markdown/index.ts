import type { JSX } from "../jsx/index.js";
import { Group, Markup, Tag } from "../markup/index.js";

/** Parsed element */
type Node = {
	/** Tag name, `""` for an implicit paragraph, `"!"` for raw HTML */
	tag: string;

	/** Attributes */
	attrs: Record<string, string>;

	/** Child elements and decoded text */
	children: (Node | string)[];
};

/** Field described in a form */
type Field = {
	/** Label text */
	label: string;

	/** Field name */
	name: string;

	/** Input type, `select`, or `textarea` */
	type: string;

	/** Current value(s) */
	value: string[];

	/** Choices for selects, radios, and checkbox groups */
	options: string[];

	/** Notes such as errors that follow the field */
	notes: string[];

	/** Requirements from attributes */
	rules: string[];

	/** A single checkbox without a `value`, a boolean, not a group of one */
	lone?: boolean;
};

export namespace Markdown {
	/** Markdown conversion options */
	export type Options = {
		/** Resolves relative links and form actions, usually the request URL */
		readonly base?: string | URL | undefined;

		/**
		 * @internal Names the tool that submits a form, if there is one, set by
		 * an MCP endpoint. The form is then described by its tool, with only its
		 * values and messages.
		 *
		 * @param method Form method
		 * @param action Resolved form action
		 * @returns Tool name
		 */
		readonly tool?:
			((method: string, action: URL) => string | undefined) | undefined;
	};
}

/** Writes Markdown from rendered chunks, one block at a time */
class Writer {
	/** Elements and their contents that are not written */
	static readonly #skip = new Set([
		"head",
		"script",
		"style",
		"template",
		"svg",
		"canvas",
		"iframe",
		"object",
		"dialog",
		"math",
	]);

	/** Containers that are not written themselves at the top level */
	static readonly #containers = new Set([
		"html",
		"body",
		"main",
		"div",
		"section",
		"article",
		"header",
		"footer",
		"nav",
		"aside",
		"hgroup",
		"search",
	]);

	/** Block elements, everything else is inline */
	static readonly #blockTags = new Set([
		...Writer.#containers,
		// raw HTML, its own block between blocks
		"!",
		"p",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"ul",
		"ol",
		"li",
		"pre",
		"blockquote",
		"hr",
		"table",
		"thead",
		"tbody",
		"tfoot",
		"tr",
		"td",
		"th",
		"caption",
		"details",
		"summary",
		"dl",
		"dt",
		"dd",
		"figure",
		"figcaption",
		"form",
		"fieldset",
		"legend",
		"address",
		"noscript",
		"menu",
	]);

	readonly #options: Markdown.Options;

	/** Open elements below the top level */
	readonly #stack: Node[] = [];

	/** Inline content at the top level */
	#pending: Node = Writer.#node("");

	/** Depth inside a skipped element */
	#skipping = 0;

	/** Reader mode: before, inside, or after `<main>` */
	#main: "before" | "inside" | "after" = "before";

	/** `<main>` elements open, so a nested one does not end the outer one */
	#depth = 0;

	/** Output before `<main>`, written at the end if there is no `<main>` */
	#before: string[] = [];

	/** Output ready to be read */
	#output = "";

	/** Blocks written */
	#count = 0;

	/** @param options Conversion options */
	constructor(options: Markdown.Options = {}) {
		this.#options = options;
	}

	/** @returns The rest of the Markdown */
	end() {
		while (this.#stack.length) this.#close(this.#stack.at(-1)!.tag);
		this.#flush();
		if (this.#main === "before") {
			for (const block of this.#before) this.#write(block, true);
		}
		if (this.#count) this.#output += "\n";
		return this.read();
	}

	/** @param chunk Rendered chunk, read by its kind instead of parsing its HTML */
	chunk(chunk: Markup.Chunk) {
		if (chunk instanceof Group) {
			for (const child of chunk.chunks) this.chunk(child);
		} else if (chunk instanceof Tag) {
			if (!chunk.props) return this.#close(chunk.name);

			const attrs: Record<string, string> = {};
			for (const name in chunk.props) {
				const value = chunk.props[name];
				// as `jsx` writes them, `true` is an attribute without a value
				if (name !== "children" && value != null && value !== false)
					attrs[name.toLowerCase()] = value === true ? "" : String(value);
			}
			this.#open(chunk.name, attrs);
			if (chunk.closed) this.#close(chunk.name);
		} else if (chunk.raw) this.#raw(chunk.value);
		else this.#text(chunk.value);
	}

	/** @returns Markdown written since it was last read */
	read() {
		const output = this.#output;
		this.#output = "";
		return output;
	}

	/** @param text Added to the open element */
	#text(text: string) {
		if (!text || this.#skipping) return;
		const parent = this.#stack.at(-1) ?? this.#pending;
		const last = parent.children.length - 1;
		if (typeof parent.children[last] === "string")
			parent.children[last] += text;
		else parent.children.push(text);
	}

	/**
	 * Raw HTML, such as from `Markup.raw`, is valid Markdown, so it is
	 * written as it is.
	 *
	 * @param html HTML
	 */
	#raw(html: string) {
		if (!html || this.#skipping) return;
		const parent = this.#stack.at(-1);
		if (parent) parent.children.push(Writer.#node("!", {}, html));
		else {
			// its own block at the top level
			this.#flush();
			this.#write(html);
		}
	}

	#open(tag: string, attrs: Record<string, string>) {
		if (this.#skipping) {
			this.#skipping++;
			return;
		}

		if (
			Writer.#skip.has(tag) ||
			"hidden" in attrs ||
			attrs["aria-hidden"] === "true"
		) {
			this.#skipping = 1;
			return;
		}

		// the page's content, however it is wrapped, such as in a custom element:
		// what came before is dropped, and its contents are read as top level
		if (tag === "main" && this.#main === "before") {
			this.#stack.length = 0;
			this.#pending = Writer.#node("");
			this.#before = [];
			this.#main = "inside";
			this.#depth = 1;
			return;
		}
		if (tag === "main" && this.#main === "inside") {
			this.#depth++;
			return;
		}

		if (!this.#stack.length) {
			if (Writer.#containers.has(tag)) {
				this.#flush();
				return;
			}

			if (Writer.#blockTags.has(tag)) this.#flush();
		}

		const node = Writer.#node(tag, attrs);
		(this.#stack.at(-1) ?? this.#pending).children.push(node);
		this.#stack.push(node);
	}

	#close(tag: string) {
		if (this.#skipping) {
			this.#skipping--;
			return;
		}

		if (tag === "main" && this.#main === "inside") {
			if (--this.#depth) return;
			// elements left open end with it, so nothing after it is written
			while (this.#stack.length) this.#close(this.#stack.at(-1)!.tag);
			this.#flush();
			this.#main = "after";
			return;
		}

		const index = this.#stack.findLastIndex((node) => node.tag === tag);

		if (index === -1) {
			if (!this.#stack.length && Writer.#containers.has(tag)) this.#flush();
			return;
		}

		const [node] = this.#stack.splice(index);

		if (!index && Writer.#blockTags.has(node!.tag)) {
			// a complete top level block
			this.#pending.children.pop();
			this.#flush();
			this.#write(this.#block(node!));
		}
	}

	/** Writes inline content at the top level as a paragraph */
	#flush() {
		const pending = this.#pending;
		if (!pending.children.length) return;
		this.#pending = Writer.#node("");
		this.#write(this.#block(pending));
	}

	/**
	 * @param block Markdown block
	 * @param force Write even before `<main>`
	 */
	#write(block: string, force?: boolean) {
		if (!block) return;
		if (this.#main === "after") return;
		if (this.#main === "before" && !force) {
			this.#before.push(block);
			return;
		}
		this.#output += (this.#count++ ? "\n\n" : "") + block;
	}

	/**
	 * @param children Nodes
	 * @returns Markdown blocks, with inline runs as paragraphs
	 */
	#blocks(children: (Node | string)[], separator = "\n\n") {
		const blocks: string[] = [];
		let run: (Node | string)[] = [];

		const paragraph = () => {
			if (!run.length) return;
			blocks.push(this.#paragraph(run));
			run = [];
		};

		for (const child of children) {
			if (typeof child === "string" || !Writer.#blockTags.has(child.tag)) {
				run.push(child);
			} else {
				paragraph();
				blocks.push(this.#block(child));
			}
		}
		paragraph();

		return blocks.filter(Boolean).join(separator);
	}

	/**
	 * @param children Inline nodes
	 * @returns Paragraph with line start characters escaped
	 */
	#paragraph(children: (Node | string)[]) {
		return this.#inline(children)
			.split("\n")
			.map((line) =>
				line.trim().replace(/^([#>+-]|\d+[.)]|={2,}|-{2,})(?=\s|$)/, "\\$1"),
			)
			.join("\n")
			.trim();
	}

	/**
	 * @param node Block element
	 * @returns Markdown
	 */
	#block(node: Node): string {
		const { tag, children } = node;

		switch (tag) {
			case "":
			case "p":
			case "dt":
			case "dd":
			case "caption":
			case "figcaption":
			case "legend":
				return tag === "dt"
					? Writer.#wrap(this.#paragraph(children), "**")
					: this.#paragraph(children);
			case "h1":
			case "h2":
			case "h3":
			case "h4":
			case "h5":
			case "h6": {
				const text = this.#inline(children).replace(/\s+/g, " ").trim();
				return text && `${"#".repeat(Number(tag[1]))} ${text}`;
			}
			case "summary":
				return Writer.#wrap(this.#paragraph(children), "**");
			case "ul":
			case "ol":
			case "menu":
				return this.#list(node);
			case "pre":
				return this.#pre(node);
			case "blockquote": {
				const text = this.#blocks(children);
				return text && text.replace(/^/gm, "> ").replace(/^> $/gm, ">");
			}
			case "hr":
				return "---";
			case "table":
				return this.#table(node);
			case "form":
				return this.#form(node);
			case "!":
				return children[0] as string;
			default:
				return this.#blocks(children);
		}
	}

	/**
	 * @param node List element
	 * @returns Markdown list
	 */
	#list(node: Node) {
		const ordered = node.tag === "ol";
		let n = Number(node.attrs.start ?? 1) || 1;
		const items: string[] = [];

		for (const child of node.children) {
			if (typeof child === "string" || child.tag !== "li") continue;
			const marker = ordered ? `${n++}. ` : "- ";
			const text = this.#blocks(child.children, "\n");
			items.push(
				marker +
					text.replace(/\n/g, "\n" + " ".repeat(marker.length)).trimEnd(),
			);
		}

		return items.join("\n");
	}

	/**
	 * @param node `<pre>` element
	 * @returns Fenced code block
	 */
	#pre(node: Node) {
		const code = node.children.find(
			(child): child is Node =>
				typeof child !== "string" && child.tag === "code",
		);
		const language = /(?:^|\s)lang(?:uage)?-(\S+)/.exec(
			code?.attrs.class ?? node.attrs.class ?? "",
		)?.[1];
		const text = Writer.#content(node).replace(/^\n/, "").replace(/\n$/, "");
		const fence = "`".repeat(Math.max(3, Writer.#ticks(text) + 1));
		return `${fence}${language ?? ""}\n${text}\n${fence}`;
	}

	/** Schemes links and images may use */
	static readonly #schemes = new Set(["http:", "https:", "mailto:", "tel:"]);

	/**
	 * @param node `<table>` element
	 * @returns GitHub flavored Markdown table
	 */
	#table(node: Node) {
		const rows: string[][] = [];
		let caption = "";

		const visit = (parent: Node) => {
			for (const child of parent.children) {
				if (typeof child === "string") continue;
				if (child.tag === "caption") caption = this.#paragraph(child.children);
				else if (child.tag === "tr") {
					rows.push(
						child.children
							.filter(
								(cell): cell is Node =>
									typeof cell !== "string" &&
									(cell.tag === "td" || cell.tag === "th"),
							)
							.map((cell) =>
								this.#inline(cell.children)
									.replace(/\s+/g, " ")
									.trim()
									.replaceAll("|", "\\|"),
							),
					);
				} else visit(child);
			}
		};
		visit(node);

		if (!rows.length) return caption;

		// a loop, a spread of many rows would overflow the stack
		let width = 0;
		for (const row of rows) width = Math.max(width, row.length);
		// the header sets the columns, shorter rows are filled in by the reader
		const line = (row: string[]) => `| ${row.join(" | ")} |`;

		return [
			caption,
			[
				line(Array.from({ length: width }, (_, i) => rows[0]![i] ?? "")),
				line(Array(width).fill("---")),
				...rows.slice(1).map(line),
			].join("\n"),
		]
			.filter(Boolean)
			.join("\n\n");
	}

	/**
	 * Describes a form: where it submits, its fields, and its buttons.
	 *
	 * @param node `<form>` element
	 * @returns Markdown
	 */
	#form(node: Node) {
		const method = (node.attrs.method ?? "GET").toUpperCase();
		// an unsafe action is described as the page itself
		const action = this.#url(node.attrs.action ?? "") ?? this.#url("")!;
		const tool = this.#options.tool?.(method, action);
		const labels = new Map<string, string>();
		const fields: Field[] = [];
		const byName = new Map<string, Field>();
		const submits: string[] = [];
		const notes: string[] = [];
		let legend = "";

		// labels with `for`
		const collect = (parent: Node) => {
			for (const child of parent.children) {
				if (typeof child === "string") continue;
				if (child.tag === "label" && child.attrs.for)
					labels.set(child.attrs.for, Writer.#plain(child));
				collect(child);
			}
		};
		collect(node);

		const field = (control: Node, label: string | undefined) => {
			const { attrs } = control;
			const name = attrs.name;
			const type =
				control.tag === "input"
					? (attrs.type ?? "text").toLowerCase()
					: control.tag;

			if (type === "submit" || type === "image") {
				submits.push(attrs.value ?? "Submit");
				return;
			}
			// a tool's form shows its hidden values, such as an ID, which the
			// tool's arguments need and the page shows nowhere else
			if (type === "hidden" && tool && name && attrs.value !== undefined) {
				const entry = Writer.#field(name, name, type);
				entry.value.push(attrs.value);
				fields.push(entry);
				byName.set(name, entry);
				return;
			}
			if (!name || type === "hidden" || type === "button" || type === "reset")
				return;

			label =
				label ||
				(attrs.id && labels.get(attrs.id)) ||
				attrs["aria-label"] ||
				name;

			if (type === "checkbox" || type === "radio") {
				let group = byName.get(name);
				const value = attrs.value ?? "on";
				if (group && group.type === type) {
					group.options.push(`${value}${label !== value ? ` (${label})` : ""}`);
					group.lone = false;
				} else {
					group = Writer.#field(legend || label, name, type);
					group.options.push(`${value}${label !== value ? ` (${label})` : ""}`);
					group.lone = type === "checkbox" && attrs.value === undefined;
					fields.push(group);
					byName.set(name, group);
				}
				if ("checked" in attrs) group.value.push(value);
				Writer.#rules(group, attrs);
				return;
			}

			const entry = Writer.#field(label, name, type);

			if (control.tag === "select") {
				if ("multiple" in attrs) entry.type = "select multiple";
				const options = (parent: Node) => {
					for (const child of parent.children) {
						if (typeof child === "string") continue;
						if (child.tag === "option") {
							const text = Writer.#plain(child);
							const value = child.attrs.value ?? text;
							entry.options.push(
								`${value}${text && text !== value ? ` (${text})` : ""}`,
							);
							if ("selected" in child.attrs) entry.value.push(value);
						} else options(child);
					}
				};
				options(control);
			} else if (control.tag === "textarea") {
				const value = Writer.#content(control).replace(/^\n/, "");
				if (value) entry.value.push(value);
			} else if (attrs.value) entry.value.push(attrs.value);

			Writer.#rules(entry, attrs);
			fields.push(entry);
			byName.set(name, entry);
		};

		const visit = (parent: Node, label?: string, quiet?: boolean) => {
			for (const child of parent.children) {
				if (typeof child === "string") {
					if (!quiet && child.trim())
						notes.push(child.replace(/\s+/g, " ").trim());
					continue;
				}

				switch (child.tag) {
					case "input":
					case "select":
					case "textarea":
						field(child, label);
						break;
					case "button":
						if ((child.attrs.type ?? "submit") === "submit")
							submits.push(Writer.#plain(child) || "Submit");
						break;
					case "label":
						// controls inside use the label
						visit(
							child,
							child.attrs.for
								? labels.get(child.attrs.for)
								: Writer.#plain(child, true),
							true,
						);
						break;
					case "legend":
						legend = Writer.#plain(child);
						break;
					case "fieldset": {
						const outer = legend;
						visit(child, label);
						legend = outer;
						break;
					}
					case "p":
					case "span":
					case "small":
					case "output":
					case "noscript":
					case "strong":
					case "em": {
						if (
							child.children.some(
								(c) =>
									typeof c !== "string" &&
									["input", "select", "textarea", "button"].includes(c.tag),
							)
						) {
							visit(child, label);
							break;
						}
						const text = this.#paragraph(child.children);
						if (text) {
							const last = fields.at(-1);
							// messages after a field, such as errors, belong to it
							if (last && child.tag !== "noscript" && !submits.length)
								last.notes.push(text);
							else notes.push(text);
						}
						break;
					}
					default:
						visit(child, label, quiet);
				}
			}
		};
		visit(node);

		const lines = [
			`**Form:** \`${method} ${this.#href(action)}\`${tool ? ` (tool \`${tool}\`)` : ""}`,
		];

		if (tool) {
			// the tool's input schema describes the fields, so only what the page
			// adds: current values, such as an edit form's, and messages
			const entries = fields
				.map((f) =>
					// a single checkbox is a boolean argument, unchecked included
					f.lone ? { ...f, value: [String(f.value.length > 0)] } : f,
				)
				.filter((f) => f.value.length || f.notes.length)
				.map((f) => {
					let line = `- ${Writer.#code(f.name)}`;
					if (f.value.length)
						line += `: ${f.value.map((v) => Writer.#code(v)).join(", ")}`;
					for (const note of f.notes) line += `\n  - ${note}`;
					return line;
				});
			if (entries.length) lines.push("", ...entries);
		} else if (fields.length) {
			lines.push(
				"",
				...fields.map((f) => {
					let line = `- ${Writer.#escape(f.label)} ${Writer.#code(f.name)} (${[f.type, ...f.rules].join(", ")})`;
					if (f.options.length)
						line += `, options: ${f.options.map((o) => Writer.#code(o)).join(", ")}`;
					if (f.value.length)
						line += `, value: ${f.value.map((v) => Writer.#code(v)).join(", ")}`;
					for (const note of f.notes) line += `\n  - ${note}`;
					return line;
				}),
			);
		}

		if (notes.length) lines.push("", ...notes);
		if (submits.length)
			lines.push("", `Submit: ${submits.map(Writer.#escape).join(", ")}`);

		return lines.join("\n");
	}

	/**
	 * @param children Inline nodes
	 * @returns Inline Markdown with whitespace collapsed
	 */
	#inline(children: (Node | string)[]): string {
		let out = "";

		for (const child of children) {
			if (typeof child === "string") {
				out += Writer.#escape(child.replace(/\s+/g, " "));
				continue;
			}

			const inner = () => this.#inline(child.children);

			switch (child.tag) {
				case "br":
					out += "\n";
					break;
				case "!":
					out += child.children[0];
					break;
				case "strong":
				case "b":
					out += Writer.#wrap(inner(), "**");
					break;
				case "em":
				case "i":
				case "cite":
				case "dfn":
					out += Writer.#wrap(inner(), "_");
					break;
				case "del":
				case "s":
					out += Writer.#wrap(inner(), "~~");
					break;
				case "code":
				case "kbd":
				case "samp":
					out += Writer.#code(Writer.#content(child).replace(/\s+/g, " "));
					break;
				case "a": {
					const text = inner().trim();
					const href = child.attrs.href;
					const resolved = href && !href.startsWith("#") && this.#url(href);
					if (!href || resolved === undefined) {
						out += text;
						break;
					}
					const url = resolved ? this.#href(resolved) : href;
					const destination = Writer.#destination(url);
					out +=
						text === url || !text
							? `<${destination}>`
							: `[${text}](${destination})`;
					break;
				}
				case "img": {
					const url = child.attrs.src && this.#url(child.attrs.src);
					if (url)
						out += `![${Writer.#escape(child.attrs.alt ?? "")}](${Writer.#destination(this.#href(url))})`;
					break;
				}
				case "input":
				case "select":
				case "textarea":
				case "button":
					// controls outside of a form do nothing without a script
					break;
				default:
					out += Writer.#blockTags.has(child.tag)
						? ` ${this.#blocks(child.children, "\n")} `
						: inner();
			}
		}

		return out;
	}

	/**
	 * @param href Possibly relative URL
	 * @returns Resolved URL, `undefined` if it is invalid or not a safe scheme such as `javascript:`
	 */
	#url(href: string) {
		try {
			// parsed first, browsers remove characters such as tabs from the scheme
			const url = new URL(href, this.#options.base ?? "http://localhost/");
			if (Writer.#schemes.has(url.protocol)) return url;
		} catch {}
	}

	/**
	 * @param url URL
	 * @returns The URL as a link destination, characters that could end it are percent-encoded
	 */
	static #destination(url: string) {
		return url.replace(
			/[\s()<>]/g,
			(char) =>
				`%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
		);
	}

	/**
	 * @param url Resolved URL
	 * @returns Relative when there is no base
	 */
	#href(url: URL) {
		return this.#options.base ? url.href : url.pathname + url.search + url.hash;
	}

	/**
	 * @param tag Tag name
	 * @param attrs Attributes
	 * @returns New element node
	 */
	static #node(
		tag: string,
		attrs: Record<string, string> = {},
		...children: string[]
	): Node {
		return { tag, attrs, children };
	}

	static #field(label: string, name: string, type: string): Field {
		return { label, name, type, value: [], options: [], notes: [], rules: [] };
	}

	/**
	 * @param field Field to add requirements to
	 * @param attrs Control attributes
	 */
	static #rules(field: Field, attrs: Record<string, string>) {
		const rules = new Set(field.rules);
		if ("required" in attrs) rules.add("required");
		if ("multiple" in attrs && field.type !== "select multiple")
			rules.add("multiple");
		for (const name of [
			"min",
			"max",
			"minlength",
			"maxlength",
			"step",
			"pattern",
			"accept",
		]) {
			if (attrs[name]) rules.add(`${name} ${attrs[name]}`);
		}
		field.rules = [...rules];
	}

	/**
	 * @param node Element
	 * @param omitControls Leave out the text of nested controls
	 * @returns Text content with whitespace collapsed
	 */
	static #plain(node: Node, omitControls?: boolean): string {
		let text = "";
		for (const child of node.children) {
			if (typeof child === "string") text += child;
			else if (!omitControls || !["select", "textarea"].includes(child.tag))
				text += " " + Writer.#plain(child, omitControls) + " ";
		}
		return text.replace(/\s+/g, " ").trim();
	}

	/**
	 * @param node Element
	 * @returns Raw text content
	 */
	static #content(node: Node): string {
		return node.children
			.map((child) =>
				typeof child === "string"
					? child
					: child.tag === "br"
						? "\n"
						: Writer.#content(child),
			)
			.join("");
	}

	/**
	 * @param text Text to put in inline code
	 * @returns Code span
	 */
	static #code(text: string) {
		// one line, so a value cannot start a line of its own, such as a form
		text = text.replace(/\s*[\r\n]+\s*/g, " ");
		const ticks = "`".repeat(Writer.#ticks(text) + 1);
		const pad = /^`|`$|^ .* $/.test(text) ? " " : "";
		return `${ticks}${pad}${text}${pad}${ticks}`;
	}

	/**
	 * @param text Text
	 * @returns Length of its longest run of backticks
	 */
	static #ticks(text: string) {
		// a loop, a spread of many runs would overflow the stack
		let longest = 0;
		for (const [run] of text.matchAll(/`+/g))
			longest = Math.max(longest, run.length);
		return longest;
	}

	/**
	 * @param text Inline Markdown
	 * @param marker Emphasis marker
	 * @returns Text wrapped in the marker, with outer whitespace kept outside
	 */
	static #wrap(text: string, marker: string) {
		const [, before, inner, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
		return inner ? `${before}${marker}${inner}${marker}${after}` : text;
	}

	/**
	 * @param text Plain text
	 * @returns Text with Markdown syntax characters escaped
	 */
	static #escape(text: string) {
		return text
			.replace(/[\\`*[\]<]/g, "\\$&")
			.replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) =>
				m.replace("_", "\\_"),
			);
	}
}

/**
 * Renders an element to Markdown, as an `AsyncIterable` of blocks, a stream,
 * or a string, from the same elements `Markup` renders. Each top level block is
 * written as soon as it closes, and when the page has a `<main>` element, only
 * its contents are kept. Raw HTML is written as it is.
 *
 * ```tsx
 * const markdown = await Markdown.string(<Post post={post} />, { base: url });
 * ```
 */
export class Markdown {
	/** Element to render */
	readonly #element: JSX.Element;

	/** Markdown options */
	readonly #options: Markdown.Options | undefined;

	/**
	 * Creates an `AsyncIterable` that renders the element to Markdown.
	 *
	 * @param element Element to render
	 * @param options Markdown options
	 */
	constructor(element: JSX.Element, options?: Markdown.Options) {
		this.#element = element;
		this.#options = options;
	}

	/** @yields Markdown as each block completes */
	async *[Symbol.asyncIterator](): AsyncGenerator<string, void, unknown> {
		const writer = new Writer(this.#options);

		for await (const chunk of new Markup(this.#element)) {
			writer.chunk(chunk);
			const text = writer.read();
			if (text) yield text;
		}

		const text = writer.end();
		if (text) yield text;
	}

	/**
	 * @param element Element to render
	 * @param options Markdown options
	 * @returns `ReadableStream` of Markdown
	 */
	static stream(element: JSX.Element, options?: Markdown.Options) {
		return Markup.stream(new Markdown(element, options), { raw: true });
	}

	/**
	 * Converts a render into a fully concatenated string of Markdown.
	 *
	 * @param element Element to render
	 * @param options Markdown options
	 * @returns Concatenated Markdown
	 */
	static async string(element: JSX.Element, options?: Markdown.Options) {
		return (await Array.fromAsync(new Markdown(element, options))).join("");
	}
}
