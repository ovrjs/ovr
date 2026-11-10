/**
 * What rendering a large page holds at once, to HTML and to Markdown.
 *
 * node --expose-gc packages/bench/src/memory/render.ts
 *
 * `OVR_DIST=/path/to/dist` measures another build, see `ovr.ts`.
 */
import { type Peak, mb, scenario } from "./measure.ts";
import { ovr, runtime } from "./ovr.ts";
import type { JSX } from "ovr/jsx-runtime";

const { Markdown, Markup } = ovr;
const { jsx } = runtime;

const rows = 10_000;

/**
 * @param lazy Rows from a generator, made as they are read, instead of an array
 * @param end Called after the last row is read, before the table ends
 * @returns A table of `rows` rows
 */
const table = (lazy: boolean, end?: () => void): JSX.Element => {
	const row = (i: number) =>
		jsx("tr", {
			children: [
				jsx("td", { children: i }),
				jsx("td", { children: `Person number ${i}` }),
				jsx("td", { children: `person${i}@example.com` }),
			],
		});
	return jsx("table", {
		children: [
			jsx("thead", {
				children: jsx("tr", {
					children: ["#", "Name", "Email"].map((h) =>
						jsx("th", { children: h }),
					),
				}),
			}),
			jsx("tbody", {
				children: lazy
					? (function* () {
							for (let i = 0; i < rows; i++) yield row(i);
							end?.();
						})()
					: Array.from({ length: rows }, (_, i) => row(i)),
			}),
		],
	});
};

/** About 5 MB of paragraphs */
const page = (): JSX.Element =>
	Array.from({ length: 5_000 }, (_, i) =>
		jsx("p", { children: `${i} ${"lorem ipsum dolor sit amet ".repeat(37)}` }),
	);

/**
 * Reads a stream to the end, sampling the live set every `every` chunks.
 *
 * @returns Bytes read
 */
const drain = async (
	stream: ReadableStream<Uint8Array>,
	peak: Peak,
	every: number,
) => {
	const reader = stream.getReader();
	let bytes = 0;
	for (let n = 0; ; n++) {
		const { done, value } = await reader.read();
		if (done) return bytes;
		bytes += value.length;
		if (n % every === 0) peak.sample();
	}
};

const main = (children: JSX.Element) => jsx("main", { children });

let size = 0;
const sized = async (stream: ReadableStream<Uint8Array>, peak: Peak) => {
	size = await drain(stream, peak, 500);
};

await scenario(`HTML, ${rows}-row table, rows in an array`, (peak) =>
	sized(Markup.stream(table(false)), peak),
);
console.log(`  output ${mb(size)} MB`);
await scenario(`HTML, ${rows}-row table, rows from a generator`, (peak) =>
	sized(Markup.stream(table(true)), peak),
);
await scenario(`Markdown, ${rows}-row table in <main>`, (peak) =>
	sized(Markdown.stream(main(table(false))), peak),
);
console.log(`  output ${mb(size)} MB`);
await scenario(
	`Markdown, ${rows}-row table in <main>, rows from a generator, sampled before </table>`,
	(peak) =>
		sized(Markdown.stream(main(table(true, () => peak.sample()))), peak),
);
await scenario(`Markdown, ${rows}-row table, no <main>`, (peak) =>
	sized(Markdown.stream(table(false)), peak),
);
await scenario("HTML, 5 MB of paragraphs in an array", (peak) =>
	sized(Markup.stream(page()), peak),
);
console.log(`  output ${mb(size)} MB`);
await scenario("Markdown, 5 MB of paragraphs in <main>", (peak) =>
	sized(Markdown.stream(main(page())), peak),
);
await scenario("Markdown, 5 MB of paragraphs, no <main>", (peak) =>
	sized(Markdown.stream(page()), peak),
);
console.log(`  output ${mb(size)} MB`);
await scenario(
	`Element tree only, ${rows}-row table in an array`,
	async (peak) => {
		const tree = table(false);
		peak.sample();
		return tree;
	},
);

// what bounding the queue could cost: time, and how long async children wait
const time = async (name: string, render: () => Promise<unknown>, runs = 5) => {
	const times: string[] = [];
	for (let run = 0; run < runs; run++) {
		const start = performance.now();
		await render();
		times.push((performance.now() - start).toFixed(1));
	}
	console.log(`\n${name}: ${times.join(", ")} ms`);
};

await time(`HTML string, ${rows}-row table in an array`, () =>
	Markup.string(table(false)),
);
await time("HTML string, 5 MB of paragraphs in an array", () =>
	Markup.string(page()),
);
await time(`Markdown string, ${rows}-row table in <main>`, () =>
	Markdown.string(main(table(false))),
);

/** @returns After 20 ms */
const later = () =>
	new Promise<string>((resolve) => setTimeout(() => resolve("x"), 20));
for (const count of [100, 2_000, 10_000]) {
	await time(
		`${count} list items each waiting 20 ms in the item (<li><Async /></li>)`,
		() =>
			Markup.string(
				Array.from({ length: count }, () => jsx("li", { children: later })),
			),
		3,
	);
	await time(
		`${count} list items each waiting 20 ms as the item (<Async />)`,
		() => Markup.string(Array.from({ length: count }, () => later)),
		3,
	);
}
