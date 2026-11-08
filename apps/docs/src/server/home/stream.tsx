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
	caption: string;
	children: o.JSX.Element;
	class?: string;
}) => (
	<figure class={`my-0 flex min-w-0 flex-col ${props.class ?? ""}`}>
		<figcaption class="caption mb-2">{props.caption}</figcaption>
		<div class="bg-base-900 text-base-100 ring-base-800 -mx-4 flex grow flex-col overflow-hidden shadow-sm ring-1 sm:mx-0 sm:rounded-md">
			{props.children}
		</div>
	</figure>
);

const Output = (props: { children: o.JSX.Element }) => (
	<pre class="my-0 grow overflow-x-auto py-4 text-sm leading-5 [tab-size:2]">
		<code>{props.children}</code>
	</pre>
);

/** The highlighted source, without the Markdown processor's code controls */
const code = source.html.match(/<pre[\s\S]*<\/pre>/)![0];

/** The source with the HTML and Markdown it streams, replayed in the browser. */
export const Stream = async () => {
	const { html, md } = await (captured ??= capture());
	const pieces = indent(html);

	return (
		<stream-demo class="block">
			<div class="grid gap-x-4 gap-y-6 lg:grid-cols-2">
				<Pane caption="todos.tsx">
					<div class="[&_pre]:my-0 [&_pre]:py-4 [&_pre]:text-sm [&_pre]:leading-5 [&_pre]:[tab-size:2]">
						{o.Markup.raw(code)}
					</div>
				</Pane>
				<div class="grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-1">
					<Pane caption="person · text/html">
						<Output>
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
						</Output>
					</Pane>
					<Pane caption="agent · text/markdown">
						<Output>
							{md.map((chunk) => (
								<span data-phase={chunk.phase}>{chunk.value}</span>
							))}
						</Output>
					</Pane>
				</div>
			</div>

			<div class="mt-3 flex items-center justify-between gap-3">
				<p class="text-muted-foreground my-0 text-sm">
					One render, streamed both ways: the heading goes out while{" "}
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
