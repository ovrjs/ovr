import * as source from "@/server/home/fields.md";
import { Dark, outputs } from "@/server/home/story";
import { indent } from "@/server/home/stream";
import * as o from "ovr";

const text = (line: string) => line.replace(/<[^>]+>/g, "");

/** The table and the add route, with the lines that define and take the field marked. */
const code = source.html
	.match(/<code[^>]*>([\s\S]*?)<\/code>/)![1]!
	.split("\n")
	.map((line) =>
		/text: Field\.text\(|\.fields\(/.test(text(line))
			? line.replace('<span class="line"', '<span class="line" data-field')
			: line,
	)
	.join("\n");

/** Highlight where the field comes through, a line at a time so indentation stays plain. */
const Mark = (props: { children: string }) =>
	props.children
		.split(/(\n[\t ]*|^[\t ]+)/)
		.map((part) => (part.trim() ? <mark>{part}</mark> : part));

/**
 * @param value Text of a card
 * @param spans Parts to highlight, in order
 * @returns The text with each part marked
 */
const highlight = (value: string, spans: string[]) => {
	const nodes: o.JSX.Element[] = [];
	let at = 0;

	for (const span of spans) {
		const i = value.indexOf(span, at);
		nodes.push(value.slice(at, i), <Mark>{span}</Mark>);
		at = i + span.length;
	}

	nodes.push(value.slice(at));
	return nodes;
};

/** One of the things the field becomes. */
const Card = (props: {
	caption: string;
	class?: string;
	children: o.JSX.Element;
}) => (
	<figure class={`my-0 flex min-w-0 flex-col ${props.class ?? ""}`}>
		<figcaption class="caption mb-2">{props.caption}</figcaption>
		<Dark class="grow">
			<pre class="my-0 py-3 text-xs leading-4 [tab-size:2]">
				<code>{props.children}</code>
			</pre>
		</Dark>
	</figure>
);

const Comment = (props: { children: string }) => (
	<span class="text-base-400">{props.children}</span>
);

/**
 * The field on the todos table, and the form, data, insert, Markdown, and tool
 * input it becomes, from running the add route.
 */
export const Fields = async () => {
	const { html, md, submitted, inserted, schema } = await outputs;

	const page = html.map((chunk) => chunk.value).join("");
	const start = page.indexOf('<form action="/todos"');
	const pieces = indent([
		{ phase: 0, value: page.slice(start, page.indexOf("</form>", start) + 7) },
	])[0]!;
	// the field is the div around its label and input
	const from = pieces.findIndex((piece) => piece.value.trim() === "<div>");
	const to = pieces.findIndex((piece) => piece.value.trim() === "</div>");

	const markdown = md.map((chunk) => chunk.value).join("");
	const form = markdown.slice(markdown.lastIndexOf("**Form:**")).trim();

	const json = JSON.stringify(schema, null, 2);
	const property = json.slice(
		json.indexOf('"text": {'),
		json.indexOf("}", json.indexOf('"text": {')) + 1,
	);

	const [data] = submitted.flatMap((result) =>
		"data" in result ? [result.data] : [],
	);
	const [issues] = submitted.flatMap((result) =>
		"issues" in result ? [result.issues] : [],
	);

	const query = inserted.text.trim().replace(" VALUES", "\nVALUES");

	return (
		<fields-demo class="block">
			<div class="grid items-start gap-x-12 gap-y-6 lg:grid-cols-2">
				<div class="grid max-w-2xl gap-4 [&>p]:my-0">
					<p class="caption">database</p>
					<h2 class="my-0">Define a field once</h2>
					<p class="text-lg">
						A <code>Table</code> describes a Postgres table with the same
						schemas forms use, so a column can be a form field. The add route
						takes <code>text</code> straight from the todos table, and that one
						definition is the form people fill in, the data the handler gets,
						the insert into Postgres, the line agents read, and the input of the
						MCP tool.
					</p>
				</div>
				<figure class="my-0">
					<figcaption class="caption mb-2">todos.tsx</figcaption>
					<Dark>
						<pre class="shiki my-0 [scrollbar-gutter:auto] py-3 text-xs leading-4 [tab-size:2]">
							<code>{o.Markup.raw(code)}</code>
						</pre>
					</Dark>
				</figure>
			</div>

			<div class="mt-8 grid grid-flow-row-dense gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<Card caption="person · the form, with its WebMCP tool">
					{pieces.map((piece, i) =>
						i > from && i < to ? (
							<Mark>{piece.value}</Mark>
						) : piece.tag ? (
							<span class="text-base-400">{piece.value}</span>
						) : (
							piece.value
						),
					)}
				</Card>

				<Card caption="agent · Markdown">
					{highlight(form, [
						form
							.split("\n")
							.find((line) => line.includes("`text`"))!
							.slice(2),
					])}
				</Card>

				<Card caption="agent · MCP tool input">
					{highlight(json, [property, '"text"'])}
				</Card>

				<Card caption="server · the handler" class="sm:col-span-2">
					{".use(async (c) => {\n\tconst result = await c.data();\n\n\t"}
					<Comment>{`// text = ${JSON.stringify(data!.text)}`}</Comment>
					{"\n\tresult.data   → { "}
					<mark>{`text: ${JSON.stringify(data!.text)}`}</mark>
					{" }\n\n\t"}
					<Comment>{'// text = ""'}</Comment>
					{"\n\tresult.issues → ["}
					{issues!.map((issue) => (
						<>
							{"{ "}
							<mark>{`path: ${JSON.stringify(issue.path)}`}</mark>
							{`, message: ${JSON.stringify(issue.message)} }`}
						</>
					))}
					{"]\n});"}
				</Card>

				<Card caption="database · the insert it sends">
					{highlight(
						`${query}\n\n${inserted.values
							.map((value, i) => `$${i + 1} = ${JSON.stringify(value)}`)
							.join("\n")}`,
						['"text"', JSON.stringify(inserted.values[0])],
					)}
				</Card>
			</div>
		</fields-demo>
	);
};
