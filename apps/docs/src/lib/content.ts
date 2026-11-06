import type { FrontmatterSchema } from "@/lib/md";
import type { Result } from "@robino/md";
import type { Middleware } from "ovr";

export const content = import.meta.glob<Result<typeof FrontmatterSchema>>(
	`@/server/docs/*.md`,
	{ eager: true },
);

export const slugs = (all?: boolean) => {
	return Object.keys(all ? { ...content, ...demos } : content)
		.map((path) =>
			path
				.split("/", 4)
				.slice(path.startsWith("/server/demo") ? 2 : 3)
				.join("/")
				.split(".")
				.at(0),
		)
		.filter(Boolean) as string[];
};

export const get = (slug: string) => content[`/server/docs/${slug}.md`];

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
