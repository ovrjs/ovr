import * as content from "@/lib/content";
import * as result from "@/server/home/index.md";
import { Network } from "@/server/home/network";
import { Story } from "@/server/home/story";
import { HomeLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import * as size from "@ovrjs/size";
import * as o from "ovr";
import { version } from "ovr/package.json";

export const page = o.Route.get("/")
	.describe("Overview of ovr, the streaming web framework, and its features")
	.use((c) => {
		content.cache(c);
		// agents read the page's source
		if (c.md(content.md(result))) return;

		return (
			<HomeLayout head={<Meta {...result.frontmatter} />}>
				<section class="relative isolate pt-6 pb-4 sm:pt-12">
					<stream-grid
						aria-hidden="true"
						class="paper-grid pointer-events-none absolute -inset-x-4 -top-8 -z-10 block h-[34rem]"
					/>
					<p class="caption mt-0 mb-6">
						ovr@{version} · {size.kb}KB · zero dependencies
					</p>
					<h1 class="mb-6 max-w-3xl">{result.frontmatter.title}</h1>
					<p class="mb-8 max-w-2xl text-xl">{result.frontmatter.description}</p>
					<div class="mb-14 flex gap-3">
						<a href="/01-get-started" class="button h-11 px-5 text-base">
							Get Started
						</a>
						<a
							href="/demo/memory"
							data-no-prefetch
							class="button h-11 px-5 text-base outline"
						>
							Demo
						</a>
					</div>
				</section>

				<section>
					<p class="caption my-0">people and agents</p>
					<h2 class="mt-2 mb-5">One app for people and agents</h2>
					<p class="mb-16 max-w-2xl text-lg">
						Most apps are built twice: a website for people, then an API or MCP
						server for agents. With ovr, the routes are the API. Describe a
						route, and people get a page with a form while agents read the same
						page as Markdown or call the route as an MCP tool. Your handlers do
						not change.
					</p>

					<Story />

					<div class="mt-10 grid max-w-2xl gap-4">
						<p class="my-0">
							With <a href="/09-auth#agents">Auth</a>, the user approves the
							agent with their passkey, and it acts as them through the same
							handlers. These docs are an ovr app. Connect your agent to them:
						</p>
						<pre class="bg-base-900 text-base-100 -mx-4 my-0 rounded-none px-4 py-3 text-sm sm:mx-0 sm:rounded-md">
							claude mcp add --transport http ovr https://ovrjs.com/mcp
						</pre>
					</div>
				</section>

				<section class="mt-28">
					<p class="caption my-0">streaming</p>
					<h2 id="streaming" class="mt-2 mb-5">
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
					<p class="caption my-0">built in</p>
					<h2 class="mt-2 mb-6">Everything an app needs</h2>
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<Features />
					</div>
				</section>

				<section class="mt-28">
					<p class="caption my-0">constraints</p>
					<h2 class="mt-2 mb-6">Intentionally constrained</h2>
					<ol class="m-0 grid list-none gap-x-6 gap-y-8 p-0 sm:grid-cols-3">
						<Constraints />
					</ol>
				</section>

				<section class="border-secondary mt-28 border-t pt-12">
					<p class="caption my-0">get started</p>
					<h2 class="mt-2 mb-6">Build your first route</h2>
					<div class="flex flex-wrap items-center gap-3">
						<pre class="bg-base-900 text-base-100 my-0 rounded-md px-4 py-0 text-sm leading-11">
							npm i ovr
						</pre>
						<a href="/01-get-started" class="button h-11 px-5 text-base">
							Get Started
						</a>
					</div>
				</section>
			</HomeLayout>
		);
	});

function* Constraints() {
	const constraints = [
		{
			title: "No client JS required",
			content: "Everything works when no client-side JavaScript runs.",
		},
		{
			title: "Streaming first",
			content:
				"Responses and request parsing start immediately, without buffering whole documents or uploads in memory.",
		},
		{
			title: "Stateless by default",
			content: "Core APIs work without server-side state.",
		},
	];

	for (const [i, constraint] of constraints.entries()) {
		yield (
			<li class="border-foreground m-0 grid content-start gap-2 border-t p-0 pt-4">
				<span class="caption">{String(i + 1).padStart(2, "0")}</span>
				<h3 class="my-0 text-lg">{constraint.title}</h3>
				<p class="text-muted-foreground my-0 text-sm">{constraint.content}</p>
			</li>
		);
	}
}

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
				class="bg-background border-secondary hover:border-foreground group rounded-md border p-5 no-underline transition-colors"
				data-no-prefetch={feature.noPrefetch}
			>
				<h3 class="my-0 text-lg transition-colors">{feature.title}</h3>
				<p class="text-muted-foreground mt-1 mb-0 text-sm">{feature.content}</p>
			</a>
		);
	}
}
