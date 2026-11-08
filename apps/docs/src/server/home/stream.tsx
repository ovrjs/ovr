import * as source from "@/server/home/stream.md";
import * as o from "ovr";

/** A chunk as it left the stream, before or after `db.todos()` resolved. */
type Chunk = { phase: 0 | 1; value: string };

const add = o.Route.post("/todos")
	.describe("Add a todo")
	.fields({ text: o.Field.text({ label: "Todo" }) })
	.use(() => {});

let captured: Promise<{ html: Chunk[]; md: Chunk[] }> | undefined;

/**
 * Render the component in the source as HTML and as Markdown at once,
 * keeping each chunk ovr streams, so the demo replays real output.
 */
const capture = async () => {
	let phase: Chunk["phase"] = 0;
	let resolve!: () => void;
	const query = new Promise<void>((r) => (resolve = r));

	async function Todos() {
		await query;

		return (
			<ul>
				{["Buy milk", "Walk the dog"].map((text) => (
					<li>{text}</li>
				))}
			</ul>
		);
	}

	const Page = () => (
		<main>
			<h1>Todos</h1>
			<Todos />
			<add.Form submit="Add" />
		</main>
	);

	const html: Chunk[] = [];
	const md: Chunk[] = [];
	const drain = async (stream: AsyncIterable<unknown>, out: Chunk[]) => {
		for await (const chunk of stream) out.push({ phase, value: String(chunk) });
	};

	// the query resolves once both streams have sent what they can without it
	setTimeout(() => {
		phase = 1;
		resolve();
	});

	await Promise.all([
		drain(new o.Markup(<Page />), html),
		drain(new o.Markdown(<Page />), md),
	]);

	return { html, md };
};

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

		if (tag && value.length > 56) {
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

const Pane = (props: {
	title: string;
	type: string;
	children: o.JSX.Element;
}) => (
	<figure class="bg-base-900 -mx-4 my-0 flex min-w-0 flex-col shadow-sm sm:mx-0 sm:rounded-md">
		<figcaption class="bg-base-800 text-base-200 flex items-center justify-between gap-2 px-4 py-1.5 font-mono text-sm sm:rounded-t-md">
			<span>{props.title}</span>
			<span class="text-base-400">{props.type}</span>
		</figcaption>
		<pre class="grow overflow-x-auto py-3 text-sm leading-5 [tab-size:2]">
			<code>{props.children}</code>
		</pre>
	</figure>
);

/** The source with the HTML and Markdown it streams, replayed in the browser. */
export const Stream = async () => {
	const { html, md } = await (captured ??= capture());
	const pieces = indent(html);

	return (
		<stream-demo class="mb-7 block">
			<div class="[&>div]:my-0 [&>div]:mb-3">{o.Markup.raw(source.html)}</div>

			<div class="grid gap-3 md:grid-cols-2">
				<Pane title="People" type="text/html">
					{html.map((chunk, i) => (
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
				<Pane title="Agents" type="text/markdown">
					{md.map((chunk) => (
						<span data-phase={chunk.phase}>{chunk.value}</span>
					))}
				</Pane>
			</div>

			<div class="mt-2 flex items-center justify-between gap-3">
				<p class="text-muted-foreground my-0 text-sm">
					Both stream from the same render: the heading goes out while{" "}
					<code>db.todos()</code> runs, and the rest follows in order.
				</p>
				<button
					type="button"
					data-replay
					hidden
					class="button ghost shrink-0 gap-2"
				>
					<span class="icon-[lucide--rotate-cw]"></span> Replay
				</button>
			</div>
		</stream-demo>
	);
};
