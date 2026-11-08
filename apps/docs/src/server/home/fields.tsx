import { Dark, lines, outputs } from "@/server/home/story";
import { indent } from "@/server/home/stream";
import * as o from "ovr";

const text = (line: string) => line.replace(/<[^>]+>/g, "");

/** The add route's lines of the source, with its field marked. */
const source = (() => {
	const from = lines.findIndex((line) => text(line).startsWith("const add"));
	const to = lines.findIndex((line, i) => i > from && text(line) === "\t});");

	return lines
		.slice(from, to + 1)
		.map((line) =>
			text(line).includes(".fields(")
				? line.replace('<span class="line"', '<span class="line" data-field')
				: line,
		)
		.join("\n");
})();

/** One of the things the field becomes. */
const Card = (props: {
	n: number;
	caption: string;
	children: o.JSX.Element;
}) => (
	<figure class="my-0 flex min-w-0 flex-col" style={`--card: ${props.n}`}>
		<figcaption class="caption mb-2">{props.caption}</figcaption>
		<Dark class="grow">
			<pre class="my-0 py-3 text-xs leading-4 [tab-size:2]">
				<code>{props.children}</code>
			</pre>
		</Dark>
	</figure>
);

/**
 * The add route's field, and the form, check, Markdown, and tool input it
 * becomes, from running the route.
 */
export const Fields = async () => {
	const { html, md, submitted, schema } = await outputs;

	const page = html.map((chunk) => chunk.value).join("");
	const start = page.indexOf('<form action="/todos"');
	const form = page.slice(start, page.indexOf("</form>", start) + 7);

	const markdown = md.map((chunk) => chunk.value).join("");

	return (
		<fields-demo class="block">
			<div class="grid items-start gap-x-12 gap-y-6 lg:grid-cols-2">
				<div class="grid max-w-2xl gap-4 [&>p]:my-0">
					<p class="caption">forms</p>
					<h2 class="my-0">Define a field once</h2>
					<p class="text-lg">
						The add route’s one field becomes the form people fill in, the check
						on the server, the line agents read, and the input of its MCP tool.
						Make it optional or rename its label, and all four follow.
					</p>
				</div>
				<figure class="my-0">
					<figcaption class="caption mb-2">todos.tsx</figcaption>
					<Dark>
						<pre class="shiki my-0 [scrollbar-gutter:auto] py-3 text-xs leading-4 [tab-size:2]">
							<code>{o.Markup.raw(source)}</code>
						</pre>
					</Dark>
				</figure>
			</div>

			<div class="mt-8 grid gap-4 sm:grid-cols-2">
				<Card n={0} caption="person · the form, with its WebMCP tool">
					{indent([{ phase: 0, value: form }])[0]!.map((piece) =>
						piece.tag ? (
							<span class="text-base-400">{piece.value}</span>
						) : (
							piece.value
						),
					)}
				</Card>

				<Card n={1} caption="server · await c.data()">
					{submitted
						.map((result) =>
							"issues" in result
								? `text = ""\n→ ${result.issues.map((issue) => issue.message).join(", ")}`
								: `text = ${JSON.stringify(result.data.text)}\n→ { text: ${JSON.stringify(result.data.text)} }`,
						)
						.join("\n\n")}
				</Card>

				<Card n={2} caption="agent · Markdown">
					{markdown.slice(markdown.lastIndexOf("**Form:**")).trim()}
				</Card>

				<Card n={3} caption="agent · MCP tool input">
					{JSON.stringify(schema, null, 2)}
				</Card>
			</div>
		</fields-demo>
	);
};
