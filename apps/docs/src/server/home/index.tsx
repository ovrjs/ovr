import * as content from "@/lib/content";
import * as result from "@/server/home/index.md";
import { Stream } from "@/server/home/stream";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import * as o from "ovr";

export const page = o.Route.get("/")
	.describe("Overview of ovr, the streaming web framework, and its features")
	.use((c) => {
		content.cache(c);
		// agents read the page's source
		if (c.md(content.md(result))) return;

		const Layout = createLayout(c);

		return (
			<Layout head={<Meta {...result.frontmatter} />}>
				<h1 class="mb-4">{result.frontmatter.title}</h1>

				<p class="mb-7 text-lg">{result.frontmatter.description}</p>

				<div class="mb-7 flex gap-3">
					<a href="/01-get-started" class="button h-11 px-5 text-base">
						Get Started
					</a>
					<a
						href="/demo/memory"
						data-no-prefetch
						class="button ghost h-11 px-5 text-base"
					>
						Demo
					</a>
				</div>

				<Stream />

				<div class="mb-7 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
					<Features />
				</div>

				<hr />

				{o.Markup.raw(result.html)}

				<hr />
			</Layout>
		);
	});

function* Features() {
	const features = [
		{
			title: "People and Agents",
			href: "/10-agents",
			content:
				"Pages as Markdown, routes as MCP tools, and forms as WebMCP tools.",
		},
		{
			title: "Generated Forms",
			href: "/demo/form",
			noPrefetch: true,
			content: "Forms from schemas, with validation and values kept on errors.",
		},
		{
			title: "Postgres",
			href: "/08-database",
			content: "Tables, typed queries, and migrations.",
		},
		{
			title: "Passkey Sign-In",
			href: "/09-auth",
			content: "For people, and for the agents they approve.",
		},
		{
			title: "Streaming JSX",
			href: "/#streaming",
			content: "Components render in parallel and stream in order.",
		},
		{
			title: "Zero Dependencies",
			href: "/01-get-started#compatibility",
			content: "Built on web standards, ovr runs anywhere fetch does.",
		},
	];

	for (const feature of features) {
		yield (
			<a
				href={feature.href}
				class="bg-muted/25 hover:bg-background border-secondary/50 hover:border-secondary rounded-md border p-4 no-underline transition-colors hover:shadow-xs"
				data-no-prefetch={feature.noPrefetch}
			>
				<h2 class="my-0 text-base">{feature.title}</h2>
				<p class="text-muted-foreground mt-1 mb-0 text-sm">{feature.content}</p>
			</a>
		);
	}
}
