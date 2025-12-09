import * as content from "@/lib/content";
import * as demos from "@/server/demo";
import * as docs from "@/server/docs";
import * as homeResult from "@/server/home/index.md";
import * as badge from "@/ui/badge";
import { FavIcon } from "@/ui/favicon";
import { FontPreload } from "@/ui/font-preload";
import { GitHub } from "@/ui/github";
import { Popover } from "@/ui/popover";
import { SkipLink } from "@/ui/skip-link";
import { tags } from "client:script";
import { clsx } from "clsx";
import * as o from "ovr";

const Assets = () => {
	return (
		<>
			{import.meta.env.DEV && (
				<link rel="stylesheet" href="/client/tailwind.css" />
			)}
			{o.Render.html(tags)}
		</>
	);
};

export const createLayout =
	(c: o.Middleware.Context) =>
	(props: { head: o.JSX.Element; children: o.JSX.Element }) => {
		return (
			<html lang="en">
				<head>
					<meta charset="utf-8" />
					<meta
						name="viewport"
						content="width=device-width, initial-scale=1.0"
					/>
					<Assets />
					<FontPreload />
					<FavIcon />
					{props.head}
				</head>
				<body>
					<drab-prefetch
						trigger="a[href^='/']:not([data-no-prefetch])"
						prerender
						class="block"
					>
						<SkipLink />
						<header class="flex justify-between gap-4 p-4 md:hidden">
							<HomeLink />
							<nav>
								<Popover
									title="ovr"
									titleHref="/"
									trigger={{
										children: (
											<span class="icon-[lucide--align-justify]"></span>
										),
									}}
								>
									<div class="flex flex-col gap-4">
										<Nav c={c} />
									</div>
								</Popover>
							</nav>
						</header>
						<main class="flex">
							<div>
								<nav class="sticky top-0 z-10 hidden max-h-dvh min-w-52 flex-col gap-4 overflow-y-auto p-4 md:flex">
									<HomeLink />
									<Nav c={c} />
								</nav>
							</div>
							<div class="flex w-full min-w-0 flex-row-reverse justify-between">
								<TOC c={c} />
								<div class="flex w-full min-w-0 justify-center">
									<div
										id="content"
										class="prose mb-16 w-full max-w-3xl min-w-0 px-4 pt-3.5 pb-4"
									>
										{props.children}
									</div>
								</div>
							</div>
						</main>
					</drab-prefetch>
				</body>
			</html>
		);
	};

const TOC = ({ c }: { c: o.Middleware.Context }) => {
	const { pathname } = c.url;

	let result: ReturnType<typeof content.get>;

	if (pathname === "/") {
		result = homeResult;
	} else {
		result = content.get(pathname.slice(1));
		if (!result) return;
	}

	return (
		<div>
			<aside class="sticky top-0 hidden min-w-52 flex-col gap-3 p-4 lg:flex">
				<h2 class="pl-3 text-xs uppercase">
					<a href="#" class="text-muted-foreground font-bold">
						On this page
					</a>
				</h2>
				<ul class="grid gap-1">
					{result.headings.map((heading) => {
						if (heading.level !== 2) return;

						return (
							<li>
								<a
									class="button ghost text-muted-foreground h-8 justify-start truncate px-3 capitalize"
									href={`#${heading.id}`}
								>
									{heading.name}
								</a>
							</li>
						);
					})}
				</ul>
			</aside>
		</div>
	);
};

const HomeLink = () => {
	return (
		<a href="/" class="pl-2 text-lg font-bold no-underline">
			ovr
		</a>
	);
};

const NavHeading = (props: { children: o.JSX.Element }) => {
	return (
		<h2 class="text-muted-foreground pl-2 text-xs font-bold uppercase">
			{props.children}
		</h2>
	);
};

const Nav = ({ c }: { c: o.Middleware.Context }) => {
	return (
		<>
			<hr />

			<NavHeading>Docs</NavHeading>
			<NavList>
				{content.slugs().map((slug) => (
					<NavLink slug={slug} c={c} />
				))}
			</NavList>

			<hr />

			<NavHeading>Demo</NavHeading>
			<NavList>
				{Object.values(demos)
					.sort((a, b) => a.pattern.localeCompare(b.pattern))
					.map((demo) => {
						if (!("Anchor" in demo)) return; // filter out post

						return (
							<li>
								<demo.Anchor
									data-no-prefetch
									class={clsx(
										"button secondary justify-start capitalize",
										demo.pattern !== c.url.pathname && "ghost",
									)}
								>
									{demo.pattern.split("/").at(2)}
								</demo.Anchor>
							</li>
						);
					})}
			</NavList>

			<hr />

			<NavHeading>Resources</NavHeading>
			<NavList>
				<NavLink slug={docs.llms.pathname().slice(1)} c={c} />
			</NavList>

			<hr />

			<ul class="flex">
				<li>
					<GitHub />
				</li>
				<li>
					<badge.Version />
				</li>
				<li>
					<badge.Size />
				</li>
			</ul>
		</>
	);
};

const NavList = (props: { children: o.JSX.Element }) => {
	return <ul class="grid gap-1">{props.children}</ul>;
};

const NavLink = (props: {
	slug?: string;
	anchor?: o.JSX.Element;
	c: o.Middleware.Context;
}) => {
	if (!props.slug) return;
	const href = `/${props.slug}`;
	const current = href === props.c.url.pathname;
	const text =
		props.slug.split("-").slice(1).join(" ") || props.slug.split(".").at(0);

	return (
		<li>
			<a
				class={clsx(
					"button secondary justify-start",
					text !== "llms" && "capitalize",
					!current && "ghost",
				)}
				href={href}
			>
				{text === "llms" ? "LLMs" : text}
			</a>
		</li>
	);
};
