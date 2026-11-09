import * as o from "ovr";

/** The pointer that clicks in the illustrations, as in the story. */
const Cursor = () => (
	<svg
		data-cursor
		class="pointer-events-none absolute top-1/2 left-1/2 z-10 size-4 drop-shadow"
		viewBox="0 0 24 24"
	>
		<path
			d="M5 3l14 8-6 1.5L9.5 19z"
			fill="var(--base-950)"
			stroke="var(--base-50)"
			stroke-width="1.5"
			stroke-linejoin="round"
		/>
	</svg>
);

/** A small window, for a page in a browser. */
const Window = (props: { class?: string; children: o.JSX.Element }) => (
	<div
		class={`border-secondary bg-background relative [scrollbar-gutter:auto] overflow-hidden rounded-sm border shadow-xs ${props.class ?? ""}`}
	>
		<div class="border-secondary flex gap-1 border-b px-2 py-1.5">
			<span class="bg-foreground/20 size-1.5 rounded-full" />
			<span class="bg-foreground/20 size-1.5 rounded-full" />
			<span class="bg-foreground/20 size-1.5 rounded-full" />
		</div>
		{props.children}
	</div>
);

/** The same page as HTML and as Markdown, each part lighting with its line. */
const PeopleAndAgents = () => {
	const row = "flex h-5 items-center rounded-xs px-1.5";
	const html = [
		<span class="bg-foreground/70 block h-2 w-12 rounded-full" />,
		<span class="bg-foreground/25 block h-1.5 w-16 rounded-full" />,
		<span class="bg-foreground/25 block h-1.5 w-20 rounded-full" />,
		<span class="bg-primary block h-3 w-8 rounded-xs" />,
	];
	const markdown = ["# Todos", "- Buy milk", "- Walk the dog", "Submit: Add"];

	return (
		<div class="grid h-full grid-cols-2 content-center gap-3 px-4">
			{[
				{ type: "text/html", rows: html },
				{ type: "text/markdown", rows: markdown },
			].map((side) => (
				<div class="grid min-w-0 gap-1.5">
					<span class="caption text-[10px]">{side.type}</span>
					<Window>
						<div class="grid p-1.5 font-mono text-[10px]">
							{side.rows.map((content, i) => (
								<span data-pair style={`--i: ${i}`} class={row}>
									<span class="truncate">{content}</span>
								</span>
							))}
						</div>
					</Window>
				</div>
			))}
		</div>
	);
};

/** A form submitted empty, which comes back with the field's issue. */
const Form = () => (
	<div class="flex h-full items-center justify-center px-4">
		<Window class="w-full max-w-56">
			<div data-reload class="grid gap-1 p-3">
				<span class="font-mono text-[10px] font-medium">Todo</span>
				<div class="flex items-center gap-2">
					<span
						data-input
						class="border-secondary h-6 grow rounded-xs border"
					/>
					<span
						data-press
						class="bg-primary text-primary-foreground relative rounded-xs px-2 py-1 font-mono text-[10px]"
					>
						Add
						<Cursor />
					</span>
				</div>
				<span data-error class="font-serif text-[10px] italic">
					Required field
				</span>
			</div>
		</Window>
	</div>
);

/** A page whose parts arrive in order while the response streams. */
const Streaming = () => {
	const chunk = (i: number, class_: string) => (
		<span data-chunk style={`--i: ${i}`} class={`block rounded-xs ${class_}`} />
	);

	return (
		<div class="flex h-full items-center justify-center px-4">
			<Window class="w-full max-w-56">
				<span
					data-progress
					class="bg-silver absolute top-[1.375rem] left-0 h-0.5 w-full origin-left"
				/>
				<div class="grid gap-2 p-3">
					{chunk(0, "bg-foreground/70 h-2 w-16")}
					<div class="grid grid-cols-2 gap-2">
						{chunk(1, "bg-foreground/15 h-8")}
						{chunk(2, "bg-foreground/15 h-8")}
					</div>
					{chunk(3, "bg-foreground/25 h-1.5 w-full")}
					{chunk(4, "bg-foreground/25 h-1.5 w-3/4")}
				</div>
			</Window>
		</div>
	);
};

const features: {
	title: string;
	href: string;
	content: string;
	noPrefetch?: boolean;
	Illustration?: () => o.JSX.Element;
}[] = [
	{
		title: "People and Agents",
		href: "/agents",
		content:
			"Pages as Markdown, routes as MCP tools, and forms as WebMCP tools.",
		Illustration: PeopleAndAgents,
	},
	{
		title: "Forms Without JavaScript",
		href: "/demo/form",
		noPrefetch: true,
		content:
			"Generated from schemas, checked on the server, with each error shown beside its field.",
		Illustration: Form,
	},
	{
		title: "Streaming First",
		href: "/render#parallelization",
		content:
			"Components render in parallel and stream in order, and uploads are parsed as they arrive.",
		Illustration: Streaming,
	},
	{
		title: "Postgres",
		href: "/database",
		content: "Tables, typed queries, and migrations.",
	},
	{
		title: "Passkey Sign-In",
		href: "/auth",
		content: "For people, and for the agents they approve.",
	},
	{
		title: "Runs Anywhere",
		href: "/get-started#compatibility",
		content:
			"No dependencies and no state in memory, so any fetch runtime, and any instance, can answer a request.",
	},
];

/**
 * In two columns, the last of an odd group of illustrated or plain cards
 * spans both, so neither kind shares a row with the other.
 */
const wide = (feature: (typeof features)[number]) => {
	const group = features.filter(
		(other) => !other.Illustration === !feature.Illustration,
	);
	return group.length % 2 === 1 && group.at(-1) === feature;
};

/**
 * The features, the first row with illustrations that play on hover or focus,
 * or once when scrolled to on touch screens.
 */
export const Features = () => (
	<feature-grid class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{features.map((feature) => (
			<a
				href={feature.href}
				data-feature
				data-no-prefetch={feature.noPrefetch}
				class={`bg-background flex [scrollbar-gutter:auto] flex-col overflow-hidden rounded-md border no-underline transition-colors ${wide(feature) ? "sm:max-lg:col-span-2" : ""}`}
			>
				{feature.Illustration && (
					<div
						aria-hidden="true"
						class="bg-muted border-secondary h-40 border-b"
					>
						<feature.Illustration />
					</div>
				)}
				<div class="p-5">
					<h3 class="my-0 text-lg">{feature.title}</h3>
					<p class="text-muted-foreground mt-1 mb-0 text-sm">
						{feature.content}
					</p>
				</div>
			</a>
		))}
	</feature-grid>
);
