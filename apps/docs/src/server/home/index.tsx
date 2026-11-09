import * as content from "@/lib/content";
import { Features } from "@/server/home/features";
import { Generator } from "@/server/home/generator";
import * as result from "@/server/home/index.md";
import { Network } from "@/server/home/network";
import { Story } from "@/server/home/story";
import { HomeLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import * as o from "ovr";

export const page = o.Route.get("/")
	.describe("Overview of ovr, the streaming web framework, and its features")
	.use((c) => {
		content.cache(c);
		// agents read the page's source
		if (c.md(content.md(result))) return;

		return (
			<HomeLayout head={<Meta {...result.frontmatter} />}>
				<section class="relative isolate pt-8 pb-4 sm:pt-12">
					<Generator />
					<h1 class="mb-6 max-w-3xl">{result.frontmatter.title}</h1>
					<p class="mb-8 max-w-2xl text-xl">{result.frontmatter.description}</p>
					<div class="mb-14 flex gap-3">
						<a href="/get-started" class="button h-11 px-5 text-base">
							Get Started
						</a>
						<a href="/demo" class="button h-11 px-5 text-base outline">
							Demo
						</a>
						<a
							href="https://github.com/ovrjs/ovr"
							class="button ghost h-11 gap-2 px-4 text-base"
						>
							<span class="icon-[lucide--github]"></span>
							GitHub
						</a>
					</div>
				</section>

				<section>
					<h2 class="mt-0 mb-5">One app for people and agents</h2>
					<p class="mb-16 max-w-2xl text-lg">
						Most apps are built twice: a website for people, then an API or MCP
						server for agents. With ovr, the routes are the API. Describe a
						route, and people get a page with a form while agents read the same
						page as Markdown or call the route as an MCP tool. Your handlers do
						not change.
					</p>

					<Story />
				</section>

				<section class="mt-28">
					<h2 id="streaming" class="mt-0 mb-5">
						Rendered how browsers read
					</h2>
					<div class="grid gap-8">
						<div class="grid max-w-2xl gap-4 [&>p]:my-0">
							<p class="text-lg">
								ovr evaluates components in parallel and streams HTML in order,
								as an{" "}
								<a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator">
									<code>AsyncGenerator</code>
								</a>{" "}
								that feeds straight into the response. Nothing waits for the
								slowest component: what is ready goes out first, like the
								heading in the demo above, and the rest follows as it resolves.
							</p>
							<p>
								Browsers are{" "}
								<a href="https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work#parsing">
									built for streaming
								</a>
								. They parse and paint HTML as it arrives, and the head goes out
								first, so CSS and JavaScript start downloading while the body
								renders. The result is a fast{" "}
								<a href="https://web.dev/articles/ttfb#what_is_ttfb">
									Time-To-First-Byte
								</a>{" "}
								with no hydration bundle and no buffering.
							</p>
						</div>
						<Network />
					</div>
				</section>

				<section class="mt-28">
					<h2 class="mt-0 mb-6">Everything an app needs</h2>
					<Features />
				</section>

				{/* inverted, so the page ends on a block in the opposite scheme */}
				<section class="bg-background text-foreground mt-28 grid gap-x-12 gap-y-8 rounded-lg px-6 py-10 [color-scheme:dark] sm:px-10 sm:py-12 lg:grid-cols-[auto_1fr] lg:items-end dark:[color-scheme:light]">
					<div>
						<h2 class="mt-0 mb-6">Build your first route</h2>
						<a href="/get-started" class="button h-11 w-fit px-5 text-base">
							Get Started
						</a>
					</div>
					<div class="grid min-w-0 justify-items-start gap-2 lg:justify-self-end">
						<p class="caption my-0">install</p>
						<Command>npm i ovr</Command>
						<p class="caption mt-4 mb-0">
							connect your agent to these docs, an ovr app
						</p>
						<Command>
							claude mcp add --transport http
							{/* a shell line continuation, so a phone fits it without scrolling */}
							<span class="sm:hidden">{" \\\n  "}</span>
							<span class="max-sm:hidden"> </span>
							ovr https://ovrjs.com/mcp
						</Command>
					</div>
				</section>
			</HomeLayout>
		);
	});

/** A command to copy, in the dark of the code blocks. */
const Command = (props: { children: o.JSX.Element }) => (
	<pre class="bg-base-900 text-base-100 my-0 max-w-full [scrollbar-width:none] overflow-x-auto rounded-md px-4 py-2.5 text-sm">
		{props.children}
	</pre>
);
