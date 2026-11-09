import * as content from "@/lib/content";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import { Route } from "ovr";

const meta = {
	title: "Demos",
	description: "Small apps built with ovr, each with its source.",
};

/** Every demo, linked from the docs nav instead of listing each one there. */
export const demoList = Route.get("/demo").use((c) => {
	const Layout = createLayout(c);

	const demos = Object.entries(content.demos)
		.map(([path, result]) => ({
			href: `/${path.split("/").slice(2, 4).join("/")}`,
			...result.frontmatter,
		}))
		// the auth demo runs only with a secret to sign its sessions
		.filter((demo) => demo.href !== "/demo/auth" || process.env.AUTH_SECRET)
		.sort((a, b) => a.title.localeCompare(b.title));

	return (
		<Layout head={<Meta {...meta} />}>
			<h1>{meta.title}</h1>
			<p>{meta.description}</p>

			<ul class="not-prose grid gap-3 p-0 sm:grid-cols-2">
				{demos.map((demo) => (
					<li class="m-0 list-none">
						<a
							href={demo.href}
							data-no-prefetch
							class="border-secondary hover:bg-muted flex h-full flex-col gap-1 rounded-md border p-4 no-underline"
						>
							<span class="font-headings text-lg">{demo.title}</span>
							<span class="text-muted-foreground text-sm">
								{demo.description}
							</span>
						</a>
					</li>
				))}
			</ul>
		</Layout>
	);
});
