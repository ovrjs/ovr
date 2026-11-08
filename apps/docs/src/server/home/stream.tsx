import * as o from "ovr";

/** A chunk as it left the stream, before or after `db.todos()` resolved. */
export type Chunk = { phase: 0 | 1; value: string };

const voids = new Set(["input"]);

/**
 * Indent the HTML for reading, keeping every piece in the chunk it came in.
 *
 * @param chunks HTML chunks
 * @returns Pieces of each chunk, tags apart from text
 */
const indent = (chunks: Chunk[]) => {
	const tokens = chunks.flatMap((chunk, i) =>
		(chunk.value.match(/<[^>]+>|[^<]+/g) ?? []).map((value) => ({ i, value })),
	);
	const pieces = chunks.map(() => [] as { tag: boolean; value: string }[]);
	let depth = 0;

	const push = (t: number, value: string, newline = true) => {
		const { i } = tokens[t]!;
		const tag = value.startsWith("<");

		if (tag && value.length > 44) {
			// one attribute a line, as a formatter would
			const [name, ...attrs] = value
				.slice(1, -1)
				.match(/[^\s"]+(?:"[^"]*")?/g)!;
			value = `<${name}${attrs.map((a) => `\n${"\t".repeat(depth + 1)}${a}`).join("")}\n${"\t".repeat(depth)}>`;
		}

		pieces[i]!.push({
			tag,
			value: (newline && t ? `\n${"\t".repeat(depth)}` : "") + value,
		});
	};

	for (let t = 0; t < tokens.length; t++) {
		const { value } = tokens[t]!;
		const name = value.match(/^<(\w+)/)?.[1];

		if (value.startsWith("</")) {
			depth--;
			push(t, value);
		} else if (!name) {
			push(t, value);
		} else if (voids.has(name)) {
			push(t, value);
		} else if (
			tokens[t + 2]?.value === `</${name}>` &&
			!tokens[t + 1]!.value.startsWith("<")
		) {
			// an element with only text stays on one line
			push(t, value);
			push(++t, tokens[t]!.value, false);
			push(++t, tokens[t]!.value, false);
		} else {
			push(t, value);
			depth++;
		}
	}

	return pieces;
};

/** A dark pane with the request it answers above what it streamed. */
const Pane = (props: {
	who: string;
	accept: string;
	children: o.JSX.Element;
}) => (
	<figure class="bg-base-900 text-base-100 ring-base-800 -mx-4 my-0 flex min-w-0 [scrollbar-gutter:auto] flex-col overflow-hidden shadow-sm ring-1 sm:mx-0 sm:rounded-md">
		{/* the same route, asking for a different type */}
		<figcaption class="border-base-800 text-base-400 flex justify-between gap-4 border-b px-4 py-2 font-mono text-sm leading-5">
			<span>
				GET /todos
				<br />
				Accept: <span class="text-base-50">{props.accept}</span>
			</span>
			<span>{props.who}</span>
		</figcaption>
		{/* on wide screens both panes fit beside the source, following the stream like a terminal */}
		<pre class="my-0 [scrollbar-width:none] overflow-x-auto py-4 text-sm leading-5 [tab-size:2] lg:max-h-[30vh] lg:overflow-y-auto">
			<code>{props.children}</code>
		</pre>
	</figure>
);

/**
 * The HTML and Markdown one request each streamed, replayed in the browser.
 *
 * @param props.await The source line that waits for the todos
 */
export const Stream = (props: {
	html: Chunk[];
	md: Chunk[];
	await: number;
}) => {
	const pieces = indent(props.html);

	return (
		<stream-demo class="grid gap-4" data-await={props.await}>
			<Pane who="person" accept="text/html">
				{props.html.map((chunk, i) => (
					<span data-phase={chunk.phase}>
						{pieces[i]!.map((piece) =>
							piece.tag ? (
								<span class="text-base-400">{piece.value}</span>
							) : (
								piece.value
							),
						)}
					</span>
				))}
			</Pane>
			<Pane who="agent" accept="text/markdown">
				{props.md.map((chunk) => (
					<span data-phase={chunk.phase}>{chunk.value}</span>
				))}
			</Pane>
			<div class="flex justify-end">
				<button type="button" data-replay hidden class="button ghost gap-2">
					<span class="icon-[lucide--rotate-cw]"></span> Replay
				</button>
			</div>
		</stream-demo>
	);
};
