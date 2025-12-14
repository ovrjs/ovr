import type { FrontmatterSchema } from "@/lib/md";
import type { Result } from "@robino/md";

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

export const demos = import.meta.glob<Result<typeof FrontmatterSchema>>(
	`@/server/demo/*/index.md`,
	{ eager: true },
);

export const md = (result: Result<typeof FrontmatterSchema>) => {
	return `# ${result.frontmatter.title}\n\n${
		result.frontmatter.description
	}${result.article}`;
};
