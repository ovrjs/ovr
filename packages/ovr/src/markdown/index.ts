import type { JSX } from "../jsx/index.js";
import { Group, type Markup, Render, Tag, readable } from "../markup/index.js";

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
		 * @internal Finds the tool that submits a form, if there is one, set by
		 * an MCP endpoint. A form is then written as the call to its tool, with
		 * the arguments its address holds, its values, and its messages. A form
		 * without a tool is left out: the agent has no way to submit it.
		 *
		 * @param method Form method
		 * @param action Resolved form action
		 * @returns The tool's name, and the arguments from the address's parameters
		 */
		readonly tool?:
			| ((
					method: string,
					action: URL,
			  ) => { name: string; args: Record<string, string> } | undefined)
			| undefined;
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

	/** Lists */
	static readonly #lists = new Set(["ul", "ol", "menu"]);

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
		...Writer.#lists,
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
	]);

	/** Attributes of an element without any, never changed */
	static readonly #none: Record<string, string> = Object.freeze({});

	readonly #options: Markdown.Options;

	/** Open elements below the top level */
	readonly #stack: Node[] = [];

	/** Inline content at the top level */
	#pending: Node = Writer.#node("");

	/** Depth inside a skipped element */
	#skipping = 0;

	/** Writing a form's table, where a control in a cell is named */
	#controls = false;

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
		this.#finish();
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

			let attrs: Record<string, string> | undefined;
			for (const name in chunk.props) {
				const value = chunk.props[name];
				// as `jsx` writes them, `true` is an attribute without a value
				if (name !== "children" && value != null && value !== false)
					(attrs ??= {})[name.toLowerCase()] =
						value === true ? "" : String(value);
			}
			// most elements have none, and a block's elements are all held until
			// it ends, so they share one empty set, which is never changed
			this.#open(chunk.name, attrs ?? Writer.#none);
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
		const node = Writer.#node("!", {}, html);
		const parent = this.#stack.at(-1);
		if (parent) parent.children.push(node);
		else if (Writer.#isBlock(node)) {
			// its own block at the top level
			this.#flush();
			this.#write(html);
		} else this.#pending.children.push(node);
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

		if (tag === "main" && this.#main !== "after") {
			// the page's content, however it is wrapped, such as in a custom
			// element: what came before is dropped, and its contents are read as
			// top level
			if (this.#main === "before") {
				this.#stack.length = 0;
				this.#pending = Writer.#node("");
				this.#before = [];
				this.#main = "inside";
			}
			// a nested one is counted, so it does not end the outer one
			this.#depth++;
			return;
		}

		if (!this.#stack.length) {
			// a container is a block too, but is not written itself
			if (Writer.#blockTags.has(tag)) this.#flush();
			if (Writer.#containers.has(tag)) return;
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
			this.#finish();
			this.#main = "after";
			return;
		}

		const index = this.#stack.findLastIndex((node) => node.tag === tag);

		if (index === -1) {
			if (!this.#stack.length && Writer.#containers.has(tag)) this.#flush();
			return;
		}

		const closed = this.#stack.splice(index);
		const node = closed[0]!;

		if (!index && (Writer.#blockTags.has(node.tag) || Writer.#holds(node))) {
			// a complete top level block
			this.#pending.children.pop();
			this.#flush();
			this.#write(this.#block(node));
			return;
		}

		// held until its block ends, such as each row of a long table, so its
		// children, final now, are kept at their size instead of the room an
		// array grows to as it is added to
		for (const done of closed) done.children = done.children.slice();
	}

	/** Ends the elements left open, and writes what is pending */
	#finish() {
		while (this.#stack.length) this.#close(this.#stack.at(-1)!.tag);
		this.#flush();
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
	 * @param separator Between blocks
	 * @param list Before a list, an item's own list follows it without a gap
	 * @returns Markdown blocks, with inline runs as paragraphs
	 */
	#blocks(children: (Node | string)[], separator = "\n\n", list = separator) {
		let blocks = "";
		let run: (Node | string)[] = [];

		const add = (block: string, between = separator) => {
			if (block) blocks += (blocks && between) + block;
		};

		const paragraph = () => {
			if (!run.length) return;
			add(this.#paragraph(run));
			run = [];
		};

		for (const child of children) {
			if (
				typeof child === "string" ||
				!(Writer.#isBlock(child) || Writer.#holds(child))
			) {
				run.push(child);
			} else {
				paragraph();
				const block = this.#block(child);
				add(
					block,
					// a list, or a tool's call on one line, follows what it belongs to
					Writer.#lists.has(child.tag) ||
						(child.tag === "form" &&
							this.#options.tool &&
							!block.includes("\n"))
						? list
						: separator,
				);
			}
		}
		paragraph();

		return blocks;
	}

	/**
	 * @param children Inline nodes
	 * @returns Paragraph with line start characters escaped
	 */
	#paragraph(children: (Node | string)[]) {
		return this.#inline(children)
			.split("\n")
			.map((line) =>
				line
					.trim()
					// a quote needs no space after it, and a line of `=` makes a heading of the one above
					.replace(/^(>|=+$|(?:[#+-]|-{2,})(?=\s|$))/, "\\$1")
					// the escape goes before the delimiter, one before a digit is text
					.replace(/^(\d+)([.)])(?=\s|$)/, "$1\\$2"),
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
			case "caption":
			case "legend":
				return this.#paragraph(children);
			case "h1":
			case "h2":
			case "h3":
			case "h4":
			case "h5":
			case "h6": {
				const text = this.#inline(children).replace(/\s+/g, " ").trim();
				return text && `${"#".repeat(Number(tag[1]))} ${text}`;
			}
			case "dt":
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

		// lines that are not blank, which need no indent
		const indent = (text: string, width: number) =>
			text.replace(/\n(?=[^\n])/g, "\n" + " ".repeat(width)).trimEnd();

		const visit = (parent: Node) => {
			for (const child of parent.children) {
				if (typeof child === "string") continue;
				if (child.tag === "li") {
					const marker = ordered ? `${n++}. ` : "- ";
					items.push(
						marker +
							indent(this.#blocks(child.children, "\n\n", "\n"), marker.length),
					);
				} else if (Writer.#lists.has(child.tag)) {
					// a list directly in a list belongs to the item before it
					const width = ordered ? `${n - 1}. `.length : 2;
					const nested = this.#list(child);
					if (!nested) continue;
					// on the lines after the item, indented as its contents are
					if (items.length)
						items[items.length - 1] += indent(`\n${nested}`, width);
					else items.push(nested);
				} else visit(child); // items inside a wrapper, such as a custom element
			}
		};
		visit(node);

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
		// the newline HTML ignores after `<pre>`, and a last one, which the
		// fence's own line break replaces
		const text = Writer.#content(node).replace(/^\n|\n$/g, "");
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
		// a form with fields cannot be written in a row, so it follows the table
		const forms: Node[] = [];

		const take = (parent: Node) => {
			parent.children = parent.children.flatMap<Node | string>((child) => {
				if (typeof child === "string") return [child];
				if (child.tag === "form") {
					const line = this.#form(child, true);
					if (line) return [Writer.#node("!", {}, line)];
					forms.push(child);
					return [];
				}
				take(child);
				return [child];
			});
		};

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
							.map((cell) => {
								take(cell);
								return this.#inline(cell.children)
									.replace(/\s+/g, " ")
									.trim()
									.replaceAll("|", "\\|");
							}),
					);
				} else visit(child);
			}
		};
		visit(node);

		let table = "";
		if (rows.length) {
			// a loop, a spread of many rows would overflow the stack
			let width = 0;
			for (const row of rows) width = Math.max(width, row.length);
			// the header sets the columns, shorter rows are filled in by the reader
			const line = (row: string[]) => `| ${row.join(" | ")} |`;

			table = [
				line(Array.from({ length: width }, (_, i) => rows[0]![i] ?? "")),
				line(Array(width).fill("---")),
				...rows.slice(1).map(line),
			].join("\n");
		}

		return [caption, table, ...forms.map((form) => this.#form(form))]
			.filter(Boolean)
			.join("\n\n");
	}

	/**
	 * Describes a form: where it submits, its fields, and its buttons.
	 *
	 * @param node `<form>` element
	 * @param cell For a table's cell: one line, empty if it does not fit
	 * @returns Markdown
	 */
	#form(node: Node, cell?: boolean) {
		const method = (node.attrs.method ?? "GET").toUpperCase();
		// an unsafe action is described as the page itself
		const action = this.#url(node.attrs.action ?? "") ?? this.#url("")!;
		const tool = this.#options.tool?.(method, action);
		// read through an MCP endpoint, only what the agent can call is a form
		if (this.#options.tool && !tool) return "";
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

		/** A new field, which a later control with its name may add to */
		const add = (label: string, name: string, type: string) => {
			const entry: Field = {
				label,
				name,
				type,
				value: [],
				options: [],
				notes: [],
				rules: [],
			};
			fields.push(entry);
			byName.set(name, entry);
			return entry;
		};

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
				add(name, name, type).value.push(attrs.value);
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
				// a box without a label of its own, such as one in each row of a
				// table, is its value alone
				const option = (value: string, label: string) =>
					`${value}${label !== value && label !== name ? ` (${label})` : ""}`;
				let group = byName.get(name);
				const value = attrs.value ?? "on";
				if (group?.type === type) group.lone = false;
				else {
					group = add(legend || label, name, type);
					group.lone = type === "checkbox" && attrs.value === undefined;
				}
				group.options.push(option(value, label));
				if ("checked" in attrs) group.value.push(value);
				Writer.#rules(group, attrs);
				return;
			}

			const entry = add(label, name, type);

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
		};

		// a block among the notes, with a line between it and the others
		const block = (text: string) => {
			if (!text) return;
			if (notes.length && notes.at(-1)) notes.push("");
			notes.push(text, "");
		};

		const visit = (parent: Node, label?: string, quiet?: boolean) => {
			for (const child of parent.children) {
				if (typeof child === "string") {
					// escaped as a paragraph is, so its text cannot write Markdown
					if (!quiet && child.trim()) notes.push(this.#paragraph([child]));
					continue;
				}

				switch (child.tag) {
					case "input":
					case "select":
					case "textarea":
						field(child, label);
						break;
					case "button":
						if ((child.attrs.type ?? "submit") === "submit") {
							let submit = Writer.#escape(Writer.#plain(child) || "Submit");
							// a button that submits somewhere else, such as a delete
							const to =
								child.attrs.formaction && this.#url(child.attrs.formaction);
							if (to) {
								const by = (child.attrs.formmethod ?? method).toUpperCase();
								const other = this.#options.tool?.(by, to);
								submit += other
									? ` (${Writer.#call(other)})`
									: ` (${Writer.#code(`${by} ${this.#href(to)}`)})`;
							}
							submits.push(submit);
						}
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
					case "table": {
						// its controls are fields, and the table is kept, with each
						// control named in its cell, a row's button included
						const before = submits.length;
						visit(child, label, true);
						submits.length = before;
						this.#controls = true;
						block(this.#table(child));
						this.#controls = false;
						break;
					}
					case "pre":
						block(this.#pre(child));
						break;
					case "!":
						// raw HTML, as it is
						if (!quiet) block(child.children[0] as string);
						break;
					case "a":
					case "p":
					case "span":
					case "small":
					case "output":
					case "noscript":
					case "strong":
					case "em": {
						if (quiet) break;
						// the tool's input schema already describes the field with it
						if (tool && "data-description" in child.attrs) break;
						if (
							child.tag !== "a" &&
							child.children.some(
								(c) =>
									typeof c !== "string" &&
									["input", "select", "textarea", "button"].includes(c.tag),
							)
						) {
							visit(child, label);
							break;
						}
						const text = this.#paragraph(
							child.tag === "a" ? [child] : child.children,
						);
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

		// how to encode the body, for an agent that submits it itself
		const encoding =
			!tool && method !== "GET" && node.attrs.enctype
				? ` as ${Writer.#code(node.attrs.enctype)}`
				: "";
		// what the form calls: its tool, or the address it submits to
		const call = tool
			? Writer.#call(tool)
			: Writer.#code(`${method} ${this.#href(action)}`);
		const submit = submits.join(", ");
		while (notes.at(-1) === "") notes.pop();

		const lines = tool
			? // the tool's input schema describes the fields, so only what the
				// page adds: current values, such as an edit form's, and messages
				fields
					.map((f) =>
						// a single checkbox is a boolean argument, unchecked included
						f.lone ? { ...f, value: [String(f.value.length > 0)] } : f,
					)
					.filter((f) => f.value.length || f.notes.length)
					.map((f) => {
						let line = `- ${Writer.#code(f.name)}`;
						if (f.value.length) line += `: ${Writer.#codes(f.value)}`;
						return Writer.#notes(f, line);
					})
			: fields.map((f) => {
					let line = `- ${Writer.#escape(f.label)} ${Writer.#code(f.name)} (${[f.type, ...f.rules].join(", ")})`;
					if (f.options.length)
						line += `, options: ${Writer.#codes(f.options)}`;
					if (f.value.length) line += `, value: ${Writer.#codes(f.value)}`;
					return Writer.#notes(f, line);
				});

		// a call an agent can make as it is written, such as a delete beside
		// each item, on one line, and only that fits in a table's cell
		if ((tool || cell) && !lines.length && !notes.length)
			return `${submit || "Submit"}: ${call}`;
		if (cell) return "";

		return [
			...(tool
				? [
						`**Tool:** ${Writer.#code(tool.name)}`,
						"",
						// arguments the address held, unless a field gives the same
						...Object.entries(tool.args)
							.filter(([name]) => !byName.get(name)?.value.length)
							.map((arg) => `- ${Writer.#argument(arg)}`),
						...lines,
					]
				: [
						`**Form:** ${call}${encoding}`,
						...(lines.length ? ["", ...lines] : []),
					]),
			...(notes.length ? ["", ...notes] : []),
			...(submits.length ? ["", `Submit: ${submit}`] : []),
		].join("\n");
	}

	/**
	 * @param tool Tool and the arguments an address gave
	 * @returns The call, as an agent makes it
	 */
	static #call(tool: { name: string; args: Record<string, string> }) {
		return [
			`tool ${Writer.#code(tool.name)}`,
			...Object.entries(tool.args).map(Writer.#argument),
		].join(", ");
	}

	/**
	 * @param argument Name and value
	 * @returns The argument, as code
	 */
	static #argument([name, value]: [string, string]) {
		return `${Writer.#code(name)}: ${Writer.#code(value)}`;
	}

	/**
	 * @param field Field in a form
	 * @param line Its line
	 * @returns The line, with the field's notes below it
	 */
	static #notes(field: Field, line: string) {
		for (const note of field.notes) line += `\n  - ${note}`;
		return line;
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
				case "button": {
					// controls outside of a form do nothing without a script
					if (!this.#controls) break;
					const { name, value, type } = child.attrs;
					if (child.tag === "button") out += inner();
					if (name && type !== "hidden") {
						// a box sends "on" without a value, others what is typed
						const sent =
							value ?? (type === "checkbox" || type === "radio" ? "on" : "");
						out += ` ${Writer.#code(sent ? `${name}=${sent}` : name)} `;
					}
					break;
				}
				default:
					out += Writer.#isBlock(child)
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

	/** Raw HTML that starts with a block element, or a comment */
	static readonly #rawBlock = new RegExp(
		`^\\s*<(?:!|(?:${[...Writer.#blockTags].filter((tag) => tag !== "!").join("|")})\\b)`,
		"i",
	);

	/**
	 * @param node Element
	 * @returns If the element is a block, raw HTML is one when it starts with one
	 */
	static #isBlock(node: Node) {
		return node.tag === "!"
			? Writer.#rawBlock.test(node.children[0] as string)
			: Writer.#blockTags.has(node.tag);
	}

	/**
	 * @param node Inline element
	 * @returns If it holds blocks, so it is read as a container, such as a
	 * custom element around a card. A link is not, its contents are its text
	 */
	static #holds(node: Node): boolean {
		return (
			node.tag !== "a" &&
			node.children.some(
				(child) =>
					typeof child !== "string" &&
					(Writer.#isBlock(child) || Writer.#holds(child)),
			)
		);
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
	 * @param values Values
	 * @returns Each as code, separated by commas
	 */
	static #codes(values: string[]) {
		return values.map((value) => Writer.#code(value)).join(", ");
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
		// most text has none of these characters, and one test costs less than
		// the replaces below, which each read all of it
		if (!/[\\`*[\]<~&_]/.test(text)) return text;

		return (
			text
				.replace(/[\\`*[\]<]/g, "\\$&")
				// a run of `~`, which strikes text through or opens a fence, and not
				// one alone, as in `~/projects`; and a character reference
				.replace(/~(?=~)|(?<=~)~|&(?=#?\w+;)/g, "\\$&")
				.replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) =>
					m.replace("_", "\\_"),
				)
		);
	}
}

/**
 * Renders an element to Markdown a step at a time, as a render of markup
 * steps through its chunks, so neither waits unless the element does.
 */
class Blocks {
	/** Render of the element's chunks */
	readonly #render: Render;

	/** Writes Markdown from the chunks */
	readonly #writer: Writer;

	/** The end of the Markdown is written */
	#ended = false;

	/**
	 * @param element Element to render
	 * @param options Markdown options
	 */
	constructor(element: JSX.Element, options?: Markdown.Options) {
		this.#render = new Render(element, undefined);
		this.#writer = new Writer(options);
	}

	/**
	 * @returns The Markdown of the next complete block or blocks, a promise to
	 * wait for before the next step, or `undefined` once all of it is written
	 */
	step() {
		for (let result; (result = this.#render.step());) {
			if (result instanceof Promise) return result;

			this.#writer.chunk(result);
			const text = this.#writer.read();
			if (text) return text;
		}

		if (this.#ended) return;
		this.#ended = true;

		return this.#writer.end() || undefined;
	}

	/** Ends the render if it is not read to its end. */
	close() {
		return this.#render.close();
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
		const blocks = new Blocks(this.#element, this.#options);

		try {
			for (let result; (result = blocks.step());) {
				if (typeof result === "string") yield result;
				else await result;
			}
		} finally {
			await blocks.close();
		}
	}

	/**
	 * @param element Element to render
	 * @param options Markdown options
	 * @returns `ReadableStream` of Markdown
	 */
	static stream(element: JSX.Element, options?: Markdown.Options) {
		return readable(new Blocks(element, options));
	}

	/**
	 * Converts a render into a fully concatenated string of Markdown.
	 *
	 * @param element Element to render
	 * @param options Markdown options
	 * @returns Concatenated Markdown
	 */
	static async string(element: JSX.Element, options?: Markdown.Options) {
		const blocks = new Blocks(element, options);
		let markdown = "";

		try {
			for (let result; (result = blocks.step());) {
				if (typeof result === "string") markdown += result;
				else await result;
			}
		} finally {
			await blocks.close();
		}

		return markdown;
	}
}
