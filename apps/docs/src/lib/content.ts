import type { FrontmatterSchema } from "@/lib/md";
import type { Result } from "@robino/md";

export const content = import.meta.glob<Result<typeof FrontmatterSchema>>(
	`@/server/docs/*.md`,
	{ eager: true },
);

export const slugs = () => {
	return Object.keys(content)
		.map((path) => {
			let slug = path.split("/").at(3)?.split(".").at(0);
			return slug;
		})
		.filter(Boolean);
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
