import * as content from "@/lib/content";
import * as homeResult from "@/server/home/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { clsx } from "clsx";
import * as ovr from "ovr";

export const llms = ovr.Route.get("/llms.txt", (c) => {
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

export const page = ovr.Route.get("/:slug", (c) => {
	let md = false;

	if (c.params.slug.endsWith(".md")) {
		md = true;
		c.params.slug = c.params.slug.slice(0, -3);
	}

	const result = content.get(c.params.slug);

	if (!result) return;

	if (md) {
		// .md extensions
		c.res.body = content.md(result);
		c.res.status = 200;
		c.res.headers.set("content-type", "text/markdown; charset=UTF-8");
		return;
	}

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
							</span>
							<span class="underline">
								{props.slug.split("-").slice(1).join(" ")}
							</span>
						</a>
					);
				};

				return (
					<div class="grid grid-cols-2 gap-4">
						<Link slug={previous} />
						<Link slug={next} class="items-end" next />
					</div>
				);
			}}
		</Layout>
	);
});
