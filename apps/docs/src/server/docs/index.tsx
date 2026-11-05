import * as content from "@/lib/content";
import * as homeResult from "@/server/home/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { clsx } from "clsx";
import * as ovr from "ovr";

export const llms = ovr.Route.get("/llms.txt")
	.describe("Read all of the ovr documentation as one Markdown document")
	.use((c) => {
		c.text(
			[
				homeResult,
				...Object.values(content.content),
				...Object.values(content.demos),
			]
				.map((result) => content.md(result))
				.join("\n"),
		);
	});

/**
 * `/04-route.md`, a page as Markdown, served before `page`, whose slug only
 * names pages.
 */
export const markdown: ovr.Middleware = (c, next) => {
	const slug = /^\/([^/]+)\.md$/.exec(c.url.pathname)?.[1];
	const result = slug && content.get(slug);
	if (!result) return next();

	c.res.body = content.md(result);
	c.res.status = 200;
	c.res.headers.set("content-type", "text/markdown; charset=UTF-8");
};

export const page = ovr.Route.get("/:slug")
	.describe(
		"Read a page of the ovr documentation, starting with 01-get-started",
	)
	// the pages, so agents see their names and other slugs are not found
	.params({ slug: ovr.Schema.enum(content.slugs() as [string, ...string[]]) })
	.use((c) => {
		const result = content.get(c.params.slug);

		if (!result) return;

		const Layout = createLayout(c);

		return (
			<Layout head={<Meta {...result.frontmatter} />}>
				<h1>{result.frontmatter.title}</h1>

				{ovr.Render.html(result.html)}

				<hr />

				{() => {
					const num = parseInt(c.params.slug);
					const previous = content.slugs().find((slug) => {
						if (!slug) return false;
						const n = parseInt(slug);
						return n === num - 1;
					});
					const next = content.slugs().find((slug) => {
						if (!slug) return false;
						const n = parseInt(slug);
						return n === num + 1;
					});

					const Link = (props: {
						slug: string | undefined;
						class?: string;
						next?: boolean;
					}) => {
						if (!props.slug) return <div></div>;

						return (
							<a
								class={clsx(
									"border-secondary flex flex-col gap-2 rounded-md border p-4 capitalize no-underline",
									props.class,
								)}
								href={`/${props.slug}`}
							>
								<span class="text-muted-foreground text-xs uppercase">
									{props.next ? "Next page" : "Previous page"}
								</span>{" "}
								<span class="underline">
									{props.slug.split("-").slice(1).join(" ")}
								</span>
							</a>
						);
					};

					return (
						<div class="grid grid-cols-2 gap-4">
							<Link slug={previous} />{" "}
							<Link slug={next} class="items-end" next />
						</div>
					);
				}}
			</Layout>
		);
	});
