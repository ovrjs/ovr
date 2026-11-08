import * as source from "@/server/home/story.md";
import { type Chunk, Stream } from "@/server/home/stream";
import * as o from "ovr";

/** Lines of the highlighted source, numbered from 1 for the steps to point at. */
const lines = source.html
	.match(/<code[^>]*>([\s\S]*?)<\/code>/)![1]!
	.split("\n")
	.map((line, i) =>
		line.replace(
			'<span class="line">',
			`<span class="line" data-line="${i + 1}">`,
		),
	);

/** The source line that waits for the todos. */
const waits =
	lines.findIndex((line) =>
		line.replace(/<[^>]+>/g, "").includes("await db.todos()"),
	) + 1;

/**
 * Run the todo routes from the source in an app of their own, so the story
 * replays what ovr sends for them.
 */
const outputs = (async () => {
	const todos = [
		{ id: "1", text: "Buy milk", done: false },
		{ id: "2", text: "Walk the dog", done: false },
	];

	// the todos come back once both requests have sent what they can without them
	let phase: Chunk["phase"] = 0;
	let resolve!: () => void;
	const query = new Promise<void>((r) => (resolve = r));

	const db = {
		async todos() {
			await query;
			return todos.filter((todo) => !todo.done);
		},
		async add(text: string) {
			todos.push({ id: String(todos.length + 1), text, done: false });
		},
		async done(id: string) {
			todos.find((todo) => todo.id === id)!.done = true;
		},
	};

	const list = o.Route.get("/todos")
		.describe("List the todos")
		.use(() => (
			<main>
				<h1>Todos</h1>
				<Todos />
				<add.Form submit="Add" />
			</main>
		));

	async function Todos() {
		const todos = await db.todos();

		return (
			<ul>
				{todos.map((todo) => (
					<li>
						{todo.text}
						<done.Form params={{ id: todo.id }} submit="Done" />
					</li>
				))}
			</ul>
		);
	}

	const add = o.Route.post("/todos")
		.describe("Add a todo")
		.fields({ text: o.Field.text({ label: "Todo" }) })
		.use(async (c) => {
			const result = await c.data();
			if (result.issues) return c.redirect(result.url, 303);

			await db.add(result.data.text);
			c.redirect(list, 303);
		});

	const done = o.Route.post("/todos/:id/done")
		.describe("Mark a todo as done")
		.use(async (c) => {
			await db.done(c.params.id);
			c.redirect(list, 303);
		});

	const app = new o.App().use(list, add, done, new o.Mcp({ name: "todos" }));

	/** Request the list, keeping each chunk of the response as it arrives. */
	const stream = async (accept: string) => {
		const res = await app.fetch(
			new Request("https://example.com/todos", { headers: { accept } }),
		);
		const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
		const chunks: Chunk[] = [];

		for (let read = await reader.read(); !read.done; read = await reader.read())
			chunks.push({ phase, value: read.value });

		// the caret ends on the last line instead of an empty one below it
		while (!chunks.at(-1)!.value.trim()) chunks.pop();
		chunks.at(-1)!.value = chunks.at(-1)!.value.trimEnd();

		return chunks;
	};

	setTimeout(() => {
		phase = 1;
		resolve();
	});

	const [html, md] = await Promise.all([
		stream("text/html"),
		stream("text/markdown"),
	]);

	const call = {
		method: "tools/call",
		params: { name: "post_todos_id_done", arguments: { id: "1" } },
	};

	return {
		html,
		md,
		markdown: md
			.map((chunk) => chunk.value)
			.join("")
			.split("\n"),
		call: JSON.stringify(call, null, 2),
	};
})();

/** Line ranges of the source each step is about. */
type Lines = [from: number, to: number][];

const Code = (props: {
	lines: Lines;
	class?: string;
	"data-code"?: boolean;
}) => (
	<pre
		data-code={props["data-code"]}
		class={`shiki my-0 text-sm [tab-size:2] ${props.class ?? "py-4 leading-5"}`}
	>
		<code>
			{o.Markup.raw(
				lines
					.filter((_, i) =>
						props.lines.some(([from, to]) => i + 1 >= from && i + 1 <= to),
					)
					.join("\n"),
			)}
		</code>
	</pre>
);

const Dark = (props: { children: o.JSX.Element; class?: string }) => (
	<div
		class={`bg-base-900 text-base-100 ring-base-800 -mx-4 overflow-x-auto font-mono shadow-sm ring-1 sm:mx-0 sm:rounded-md ${props.class ?? ""}`}
	>
		{props.children}
	</div>
);

/** A browser window with the todo page, as a person sees it. */
const Browser = (props: { click?: boolean }) => (
	<div class="grid gap-2">
		<div class="border-secondary bg-background relative overflow-hidden rounded-md border shadow-sm">
			<div class="bg-muted border-secondary flex items-center gap-3 border-b px-3 py-2">
				<span class="flex gap-1.5" aria-hidden="true">
					<span class="bg-base-300 size-2.5 rounded-full" />
					<span class="bg-base-300 size-2.5 rounded-full" />
					<span class="bg-base-300 size-2.5 rounded-full" />
				</span>
				<span class="bg-background text-muted-foreground grow rounded-sm px-2 py-0.5 font-mono text-xs">
					example.com/todos
				</span>
			</div>
			<div class="p-5 text-sm">
				<p class="text-heading-foreground font-headings mt-0 mb-3 text-lg font-semibold">
					Todos
				</p>
				<ul class="my-0 grid list-none gap-2 p-0">
					{["Buy milk", "Walk the dog"].map((text, i) => (
						<li
							class="my-0 flex items-center justify-between gap-3 p-0"
							data-row={props.click && i === 0 ? "" : undefined}
						>
							<span>{text}</span>
							<span
								class="bg-primary text-primary-foreground rounded-sm px-2.5 py-1 font-mono text-xs font-medium"
								data-done={props.click && i === 0 ? "" : undefined}
							>
								Done
								{props.click && i === 0 && (
									<svg
										data-cursor
										class="pointer-events-none absolute z-10 size-5 drop-shadow"
										viewBox="0 0 24 24"
										aria-hidden="true"
									>
										<path
											d="M5 3l14 8-6 1.5L9.5 19z"
											fill="var(--base-950)"
											stroke="var(--base-50)"
											stroke-width="1.5"
											stroke-linejoin="round"
										/>
									</svg>
								)}
							</span>
						</li>
					))}
				</ul>
				<div class="border-secondary mt-4 flex items-end gap-2 border-t pt-4">
					<span class="grid grow gap-1">
						<span class="font-mono text-xs font-medium">Todo</span>
						<span class="border-secondary h-7 rounded-sm border" />
					</span>
					<span class="bg-primary text-primary-foreground rounded-sm px-2.5 py-1.5 font-mono text-xs font-medium">
						Add
					</span>
				</div>
			</div>
		</div>
		{props.click && (
			<p data-request class="caption my-0">
				POST /todos/1/done → 303 See Other → GET /todos
			</p>
		)}
	</div>
);

/** The todo page as an agent reads it, and the tool call it makes from it. */
const Agent = (props: { markdown: string[]; call: string }) => (
	<div class="grid gap-3">
		<Dark>
			<pre class="my-0 py-4 text-sm leading-5 whitespace-pre-wrap">
				{props.markdown.map((line) => {
					// the form the agent calls, marked from its method to its URL
					const at = line.includes("/todos/1/done") ? line.indexOf("POST") : -1;

					return (
						<span class="block min-h-5">
							{at === -1 ? (
								line
							) : (
								<>
									{line.slice(0, at)}
									<span data-target>{line.slice(at, -1)}</span>
									{line.slice(-1)}
								</>
							)}
						</span>
					);
				})}
			</pre>
		</Dark>
		<div data-call>
			<Dark class="bg-base-800">
				<pre class="my-0 py-4 text-sm leading-5">
					{props.call.split("\n").map((line, i) => (
						<span class="block" style={`--line: ${i}`}>
							{line}
						</span>
					))}
				</pre>
			</Dark>
		</div>
		<p data-request class="caption my-0">
			post_todos_id_done → 303 See Other → GET /todos
		</p>
	</div>
);

/** A numbered step's caption, title, and text. */
const Heading = (props: {
	n: number;
	caption: string;
	title: string;
	children: o.JSX.Element;
}) => (
	<>
		<p class="caption my-0">
			<span class="text-heading-foreground">
				{String(props.n).padStart(2, "0")}
			</span>{" "}
			· {props.caption}
		</p>
		<h3 class="my-0 text-2xl">{props.title}</h3>
		<div class="[&>p]:my-0">{props.children}</div>
	</>
);

const Step = (props: {
	n: number;
	lines: Lines;
	/**
	 * Lines shown with the step on small screens, where the source isn't
	 * beside it, left out when the page already showed them
	 */
	snippet?: Lines;
	caption: string;
	title: string;
	children: o.JSX.Element;
	figure: o.JSX.Element;
}) => (
	<section
		data-step={props.n}
		data-lines={props.lines.map((range) => range.join("-")).join(",")}
		class="my-0 grid content-center gap-4 py-10 lg:min-h-[80vh]"
	>
		<Heading n={props.n} caption={props.caption} title={props.title}>
			{props.children}
		</Heading>
		{props.snippet && (
			<Dark class="lg:hidden">
				<Code lines={props.snippet} />
			</Dark>
		)}
		{props.figure}
	</section>
);

/** The todo routes, followed for a person and for an agent as you scroll. */
export const Story = async () => {
	const { html, md, markdown, call } = await outputs;

	return (
		<scroll-story class="block">
			<div class="grid gap-x-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
				<div class="hidden pt-10 lg:block">
					<div class="sticky top-6">
						<p class="caption mt-0 mb-2">todos.tsx</p>
						<Dark>
							{/* tighter lines, so the whole source fits beside the steps */}
							<Code
								data-code
								lines={[[1, lines.length]]}
								class="max-h-[calc(100vh-5rem)] [scrollbar-width:none] overflow-y-auto py-3 leading-[1.125rem]"
							/>
						</Dark>
					</div>
				</div>

				<div>
					<Step
						n={1}
						lines={[[1, 24]]}
						snippet={[[1, 24]]}
						caption="person and agent · GET /todos"
						title="One route, two requests"
						figure={<Stream html={html} md={md} await={waits} />}
					>
						<p>
							The list route renders once and streams both ways: HTML for a
							browser, Markdown when the request accepts{" "}
							<code>text/markdown</code>. The heading goes out while{" "}
							<code>db.todos()</code> runs, and the rest follows in order.
						</p>
					</Step>

					<Step
						n={2}
						lines={[
							[17, 20],
							[26, 31],
						]}
						snippet={[[26, 31]]}
						caption="person · text/html · POST /todos/1/done"
						title="People see it and click Done"
						figure={<Browser click />}
					>
						<p>
							The list route streams a page with a form for each todo. “Done”
							posts to the done route, which redirects back to the list, and it
							works before any JavaScript loads.
						</p>
					</Step>

					<Step
						n={3}
						lines={[
							[1, 2],
							[26, 27],
						]}
						caption="agent · text/markdown · POST /mcp"
						title="Agents read it and call a tool"
						figure={<Agent markdown={markdown} call={call} />}
					>
						<p>
							The same handler streams the page as Markdown, with each form and
							where it posts. A route with <code>.describe()</code> is also an{" "}
							<a href="/10-agents#mcp">MCP</a> tool, so the agent calls “Done”
							as <code>post_todos_id_done</code>: the handler runs as it did for
							the click, follows its redirect, and returns the page as Markdown.
						</p>
					</Step>
				</div>
			</div>
		</scroll-story>
	);
};
