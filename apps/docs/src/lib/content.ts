import type { FrontmatterSchema } from "@/lib/md";
import type { Result } from "@robino/md";
import type { Middleware } from "ovr";

const pages = import.meta.glob<Result<typeof FrontmatterSchema>>(
	`@/server/docs/*/index.md`,
	{ eager: true },
);

/**
 * The docs pages in reading order, grouped for the nav, each served at its
 * folder name. URLs don't hold the order, so moving a page keeps its links.
 */
export const sections = [
	{ name: "Start", slugs: ["get-started"] },
	{ name: "Basics", slugs: ["app", "route", "middleware", "render"] },
	{ name: "Features", slugs: ["schema", "agents", "database", "auth"] },
	{ name: "Reference", slugs: ["multipart"] },
];

const order = sections.flatMap((section) => section.slugs);

/** The docs pages by slug, in reading order. */
export const content = Object.fromEntries(
	order.map((slug) => {
		const page = pages[`/server/docs/${slug}/index.md`];
		if (!page) throw new Error(`No docs page for "${slug}"`);
		return [slug, page];
	}),
);

if (Object.keys(pages).length !== order.length)
	throw new Error("Every docs page must be listed in the reading order");

/**
 * @param all Include the demos
 * @returns The docs pages' slugs in reading order, then the demos'
 */
export const slugs = (all?: boolean) => [
	...order,
	...(all
		? Object.keys(demos).map((path) => path.split("/").slice(2, 4).join("/"))
		: []),
];

export const get = (slug: string) => content[slug];

export const demos = {
	...import.meta.glob<Result<typeof FrontmatterSchema>>(
		["@/server/demo/*/index.md", "!@/server/demo/auth/index.md"],
		{ eager: true },
	),
	...(import.meta.env.DEV &&
		import.meta.glob<Result<typeof FrontmatterSchema>>(
			"@/server/demo/auth/index.md",
			{ eager: true },
		)),
};

/**
 * Pages only change with a deployment, which clears Vercel's cache, so the
 * cache keeps them, a copy for each `Accept`, HTML or Markdown.
 *
 * @param c Request context
 */
export const cache = (c: Pick<Middleware.Context, "res">) =>
	c.res.headers.set("cache-control", "public, max-age=0, s-maxage=31536000");

export const md = (result: Result<typeof FrontmatterSchema>) => {
	return `# ${result.frontmatter.title}\n\n${
		result.frontmatter.description
	}${result.article}`;
};
