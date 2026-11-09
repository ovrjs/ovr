import * as content from "@/lib/content";
import { demoList } from "@/server/demo/list";
import * as docs from "@/server/docs";
import * as badge from "@/ui/badge";
import { FavIcon } from "@/ui/favicon";
import { FontPreload } from "@/ui/font-preload";
import { GitHub } from "@/ui/github";
import { Mark } from "@/ui/mark";
import { Popover } from "@/ui/popover";
import { SkipLink } from "@/ui/skip-link";
import * as size from "@ovrjs/size";
import * as script from "client:script";
import * as style from "client:style";
import * as o from "ovr";
import { version } from "ovr/package.json";

const Assets = () => {
	return o.Markup.raw(script.tags + style.tags);
};

/** The document around each page. */
const Document = (props: { head: o.JSX.Element; children: o.JSX.Element }) => {
	return (
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
					{props.children}
				</drab-prefetch>
			</body>
		</html>
	);
};

/** A docs page, with the nav beside it and its table of contents. */
export const createLayout =
	(c: o.Middleware.Context<any, any>) =>
	(props: { head: o.JSX.Element; children: o.JSX.Element }) => {
		return (
			<Document head={props.head}>
				{/* the logo sits where the home page puts it, so it holds still between them */}
				<header class="flex items-center justify-between gap-4 px-2 py-2.5 md:hidden">
					<HomeLink />
					<nav>
						<Popover
							title="ovr"
							titleHref="/"
							titleContent={
								<span class="home-link flex items-center">
									<Mark class="size-6" />
								</span>
							}
							trigger={{
								children: <span class="icon-[lucide--align-justify]"></span>,
							}}
						>
							<div class="flex flex-col gap-4">
								<Nav c={c} />
							</div>
						</Popover>
					</nav>
				</header>
				<div class="flex">
					<div>
						<nav class="sticky top-0 z-10 hidden h-dvh min-w-52 flex-col gap-4 overflow-y-auto p-4 md:flex">
							<HomeLink />
							<Nav c={c} />
						</nav>
					</div>
					{/* the contents sit beside the page, centered together */}
					<div class="flex w-full min-w-0 justify-center xl:gap-8">
						{/* the page's own content, which agents read as Markdown */}
						<main
							id="content"
							class="prose mb-16 w-full max-w-3xl min-w-0 px-4 pt-3.5 pb-4"
						>
							{props.children}
						</main>
						<TOC c={c} />
					</div>
				</div>
			</Document>
		);
	};

/** The home page, full width without the docs nav. */
export const HomeLayout = (props: {
	head: o.JSX.Element;
	children: o.JSX.Element;
}) => {
	return (
		<Document head={props.head}>
			{/* the closing band runs to the page's edges, without scrolling it sideways */}
			<div class="overflow-x-clip">
				{/* the hero links to the docs, the demos, and GitHub */}
				<header class="mx-auto flex h-15 max-w-5xl items-center gap-3 px-2">
					<HomeLink />
					<p class="caption my-0 text-xs">
						ovr@{version} · {size.kb}KB
					</p>
				</header>
				{/* the page ends on its closing band, so nothing comes after it */}
				<main id="content" class="prose mx-auto w-full max-w-5xl min-w-0 px-4">
					{props.children}
				</main>
			</div>
		</Document>
	);
};

const TOC = ({ c }: { c: o.Middleware.Context }) => {
	const result = content.get(c.url.pathname.slice(1));
	if (!result) return;

	return (
		// starts level with the text under the page's title, then sticks near the top
		<div class="pt-22">
			<aside class="sticky top-0 hidden min-w-52 flex-col gap-3 p-4 lg:flex">
				<h2 class="font-ui pl-3 text-xs tracking-wide uppercase">
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
									class="nav-link text-muted-foreground hover:text-foreground block truncate px-3 py-1.5 text-sm capitalize"
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
		<a
			href="/"
			aria-label="ovr home"
			class="home-link flex items-center pl-2 no-underline"
		>
			<Mark class="size-6" />
		</a>
	);
};

const NavHeading = (props: { children: o.JSX.Element }) => {
	return (
		<h2 class="text-muted-foreground font-ui my-0 pl-2 text-xs font-normal tracking-wide lowercase">
			{props.children}
		</h2>
	);
};

const Nav = ({ c }: { c: o.Middleware.Context }) => {
	return (
		<>
			<hr />

			{/* the pages in reading order, grouped by what they cover */}
			<div class="grid gap-6">
				{content.sections.map((section) => (
					<section class="grid gap-1.5">
						<NavHeading>{section.name}</NavHeading>
						<NavList>
							{section.slugs.map((slug) => (
								<NavLink href={`/${slug}`} c={c}>
									{content.get(slug)!.frontmatter.title}
								</NavLink>
							))}
							{section.name === "Reference" && (
								<NavLink href={docs.llms.url()} c={c}>
									llms.txt
								</NavLink>
							)}
						</NavList>
					</section>
				))}
			</div>

			<hr />

			<NavList>
				<NavLink
					href={demoList.url()}
					c={c}
					current={c.url.pathname.startsWith(demoList.url())}
				>
					Demos
				</NavLink>
			</NavList>

			<ul class="mt-auto flex items-center justify-between">
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
	return <ul class="grid gap-0.5">{props.children}</ul>;
};

const NavLink = (props: {
	href: string;
	c: o.Middleware.Context;
	/** Defaults to the link being the current page. */
	current?: boolean;
	children: o.JSX.Element;
}) => {
	const current = props.current ?? props.href === props.c.url.pathname;

	return (
		<li>
			<a
				class="nav-link block px-2 py-1.5 text-[0.9375rem]"
				href={props.href}
				{...(current && { "aria-current": "page" as const })}
			>
				{props.children}
			</a>
		</li>
	);
};
