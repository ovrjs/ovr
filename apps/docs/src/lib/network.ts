/**
 * Illustrative timings of one page load, streamed and buffered, drawn as a
 * network panel on the home page by the server and replayed in the browser.
 */

export type Mode = "streamed" | "buffered";

/** Length of the timeline in milliseconds. */
export const duration = 1000;

/** How much slower than the timeline the browser replays it. */
export const slowdown = 4;

export const requests = ["todos", "style.css", "script.js", "font.woff2"];

/** The document's HTML, in the chunks it arrives in. */
export const chunks = [
	`<!doctype html>
<html>
<head>
	<link rel="stylesheet" href="/style.css">
	<script type="module" src="/script.js"></script>
</head>
<body>`,
	`
	<h1>Todos</h1>`,
	`
	<ul>
		<li>Buy milk</li>
		<li>Walk the dog</li>
	</ul>`,
	`
</body>
</html>`,
];

type Request = {
	/** When the request is sent. */
	start: number;
	/** When the first byte of the response arrives. */
	first: number;
	/** When the response is finished. */
	end: number;
};

export const timings: Record<
	Mode,
	{
		requests: Request[];
		/** When each of the document's chunks arrives. */
		chunks: number[];
		/** When the page first paints. */
		paint: number;
		/** When the last request finishes. */
		finish: number;
	}
> = {
	// the head goes out at once, so the assets load while `db.todos()` runs
	streamed: {
		requests: [
			{ start: 0, first: 40, end: 720 },
			{ start: 60, first: 90, end: 170 },
			{ start: 60, first: 100, end: 230 },
			{ start: 180, first: 210, end: 300 },
		],
		chunks: [40, 60, 700, 720],
		paint: 180,
		finish: 720,
	},
	// nothing goes out until the whole page has rendered
	buffered: {
		requests: [
			{ start: 0, first: 690, end: 730 },
			{ start: 740, first: 770, end: 850 },
			{ start: 740, first: 780, end: 910 },
			{ start: 860, first: 890, end: 980 },
		],
		chunks: [700, 700, 710, 720],
		paint: 860,
		finish: 980,
	},
};

/** Position on the timeline as a percentage of its width. */
const percent = (ms: number) => (ms / duration) * 100;

/** A bar from `from` to `to`, empty until `to` is past `from`. */
const bar = (from: number, to: number) =>
	`left:${percent(from)}%;width:${Math.max(0, percent(to) - percent(from))}%`;

/**
 * Where everything in the panel is at a time on the timeline.
 *
 * @param mode How the page is sent
 * @param t Time in milliseconds
 */
export const frame = (mode: Mode, t: number) => {
	const timing = timings[mode];

	return {
		requests: timing.requests.map((request) => ({
			wait: bar(request.start, Math.min(t, request.first)),
			load: bar(request.first, Math.min(t, request.end)),
		})),
		chunks: timing.chunks.map((at) => ({
			left: `left:${percent(at)}%`,
			arrived: t >= at,
		})),
		paint: { left: `left:${percent(timing.paint)}%`, shown: t >= timing.paint },
		finished: t >= timing.finish,
		playhead: `left:${percent(t)}%`,
	};
};
