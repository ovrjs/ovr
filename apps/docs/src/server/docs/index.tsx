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

export const page = ovr.Route.get("/:slug")
	.describe("Read a page of the ovr documentation, starting with get-started")
	// the pages, so agents see their names and other slugs are not found
	.params({ slug: ovr.Schema.enum(content.slugs() as [string, ...string[]]) })
	.use((c) => {
		const result = content.get(c.params.slug);

		if (!result) return;

		content.cache(c);
		// agents read the page's source
		if (c.md(content.md(result))) return;

		const Layout = createLayout(c);

		return (
			<Layout head={<Meta {...result.frontmatter} />}>
				<h1>{result.frontmatter.title}</h1>

				{ovr.Markup.raw(result.html)}

				<hr />

				{() => {
					const slugs = content.slugs();
					const i = slugs.indexOf(c.params.slug);
					const previous = slugs[i - 1];
					const next = slugs[i + 1];

					const Link = (props: {
						slug: string | undefined;
						class?: string;
						next?: boolean;
					}) => {
						if (!props.slug) return <div></div>;

						return (
							<a
								class={clsx(
									"border-secondary flex flex-col gap-2 rounded-md border p-4 no-underline",
									props.class,
								)}
								href={`/${props.slug}`}
							>
								<span class="text-muted-foreground text-xs uppercase">
									{props.next ? "Next page" : "Previous page"}
								</span>{" "}
								<span class="underline">
									{content.get(props.slug)!.frontmatter.title}
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
