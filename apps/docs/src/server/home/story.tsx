import * as source from "@/server/home/story.md";
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

/**
 * Run the todo routes from the source in an app of their own, so the story
 * shows what ovr sends agents for them.
 */
const outputs = (async () => {
	const todos = [
		{ id: "1", text: "Buy milk", done: false },
		{ id: "2", text: "Walk the dog", done: false },
	];
	const open = () => todos.filter((todo) => !todo.done);

	const list = o.Route.get("/todos")
		.describe("List the todos")
		.use(() => (
			<main>
				<h1>Todos</h1>
				<ul>
					{open().map((todo) => (
						<li>
							{todo.text} <done.Form params={{ id: todo.id }} submit="Done" />
						</li>
					))}
				</ul>
				<add.Form submit="Add" />
			</main>
		));

	const add = o.Route.post("/todos")
		.describe("Add a todo")
		.fields({ text: o.Field.text({ label: "Todo" }) })
		.use(async (c) => {
			const result = await c.data();
			if (result.issues) return c.redirect(result.url, 303);

			todos.push({
				id: String(todos.length + 1),
				text: result.data.text,
				done: false,
			});
			c.redirect(list, 303);
		});

	const done = o.Route.post("/todos/:id/done")
		.describe("Mark a todo as done")
		.use((c) => {
			todos.find((todo) => todo.id === c.params.id)!.done = true;
			c.redirect(list, 303);
		});

	const app = new o.App().use(list, add, done, new o.Mcp({ name: "todos" }));
	const origin = "https://example.com";

	const markdown = await (
		await app.fetch(
			new Request(`${origin}/todos`, { headers: { accept: "text/markdown" } }),
		)
	).text();

	const version = "2026-07-28";
	const call = {
		method: "tools/call",
		params: { name: "post_todos_id_done", arguments: { id: "1" } },
	};
	const response = await app.fetch(
		new Request(`${origin}/mcp`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				"mcp-protocol-version": version,
				"mcp-method": call.method,
				"mcp-name": call.params.name,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: call.method,
				params: {
					...call.params,
					_meta: {
						"io.modelcontextprotocol/protocolVersion": version,
						"io.modelcontextprotocol/clientInfo": {
							name: "agent",
							version: "1",
						},
						"io.modelcontextprotocol/clientCapabilities": {},
					},
				},
			}),
		}),
	);
	const { result } = await response.json();

	return {
		markdown,
		call: JSON.stringify(call, null, 2),
		result: result.content[0].text as string,
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
		class={`shiki my-0 py-4 text-sm leading-5 [tab-size:2] ${props.class ?? ""}`}
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

const Step = (props: {
	n: number;
	lines: Lines;
	/**
	 * Lines shown with the step on small screens, where the source isn't
	 * beside it, left out when an earlier step already showed them
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
		<p class="caption my-0">
			<span class="text-heading-foreground">
				{String(props.n).padStart(2, "0")}
			</span>{" "}
			· {props.caption}
		</p>
		<h3 class="my-0 text-2xl">{props.title}</h3>
		<div class="[&>p]:my-0">{props.children}</div>
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
	const { markdown, call, result } = await outputs;

	return (
		<scroll-story class="block">
			<div class="grid gap-x-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
				<div class="hidden lg:block">
					<div class="sticky top-[10vh]">
						<p class="caption mt-10 mb-2">todos.tsx</p>
						<Dark>
							<Code
								data-code
								lines={[[1, lines.length]]}
								class="max-h-[80vh] overflow-y-auto"
							/>
						</Dark>
					</div>
				</div>

				<div>
					<Step
						n={1}
						lines={[[1, 16]]}
						snippet={[[1, 16]]}
						caption="person · GET /todos"
						title="People get a page"
						figure={<Browser />}
					>
						<p>
							The list route streams HTML, with a form to finish each todo and
							one to add another.
						</p>
					</Step>

					<Step
						n={2}
						lines={[
							[10, 10],
							[29, 34],
						]}
						snippet={[[29, 34]]}
						caption="person · POST /todos/1/done"
						title="A click submits a form"
						figure={<Browser click />}
					>
						<p>
							“Done” posts to the done route, which redirects back to the list.
							It works before any JavaScript loads.
						</p>
					</Step>

					<Step
						n={3}
						lines={[[1, 16]]}
						caption="agent · GET /todos · Accept: text/markdown"
						title="Agents read the same page"
						figure={
							<Dark>
								<pre class="my-0 py-4 text-sm leading-5 whitespace-pre-wrap">
									{markdown.trim()}
								</pre>
							</Dark>
						}
					>
						<p>
							The same handler streams Markdown instead of HTML. Each form names
							the tool that submits it.
						</p>
					</Step>

					<Step
						n={4}
						lines={[[29, 34]]}
						caption="agent · POST /mcp"
						title="And call it as a tool"
						figure={
							<div class="grid gap-3" data-call>
								<Dark>
									<pre class="my-0 py-4 text-sm leading-5">{call}</pre>
								</Dark>
								<Dark class="bg-base-800">
									<pre
										data-result
										class="my-0 py-4 text-sm leading-5 whitespace-pre-wrap"
									>
										{result.trim()}
									</pre>
								</Dark>
							</div>
						}
					>
						<p>
							Described routes are <a href="/10-agents#mcp">MCP</a> tools. The
							call runs the same handler, follows its redirect, and returns the
							page as Markdown.
						</p>
					</Step>
				</div>
			</div>
		</scroll-story>
	);
};
