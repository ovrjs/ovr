/**
 * Memory measurement helpers. Run the scripts in this directory with
 * `node --expose-gc packages/bench/src/memory/<name>.ts` after
 * `npm run build -w ovr`, they import the built package.
 *
 * Numbers come from a full collection at each sample point, so they are what
 * is reachable at once, not garbage waiting to be collected. A scenario
 * chooses its sample points, so a peak between them can be missed: each
 * script samples where it expects the most to be held.
 */

const gc = (globalThis as { gc?: (options?: object) => void }).gc;

/**
 * Memory figures in bytes: the JS heap, `external`, and `arrayBuffers`. In
 * Node 26 an ordinary `ArrayBuffer` counts in both of the last two, a
 * resizable one only in `external`, and the data of a `Blob` or `File` only
 * in `arrayBuffers`. Growth outside the heap is taken as the larger of the
 * two growths, which does not count twice what both count, but undercounts
 * when blobs and resizable buffers are held at once: both are printed.
 */
type Usage = { heap: number; external: number; buffers: number };

/** @returns Current usage */
export const usage = (): Usage => {
	const m = process.memoryUsage();
	return { heap: m.heapUsed, external: m.external, buffers: m.arrayBuffers };
};

/**
 * @param u Usage
 * @param base Usage to compare with
 * @returns Growth of the heap and of memory outside it
 */
const total = (u: Usage, base: Usage) =>
	u.heap -
	base.heap +
	Math.max(u.external - base.external, u.buffers - base.buffers);

/**
 * Full collection, as a last resort so that freed buffers are swept before it
 * returns: after an ordinary `gc()`, `external` still counts them
 */
export const collect = () => {
	if (!gc) throw new Error("Run with node --expose-gc");
	gc({ type: "major", execution: "sync", flavor: "last-resort" });
};

/** Tracks the largest usage seen during one run */
export class Peak {
	readonly base: Usage;
	live: Usage & { total: number } = {
		heap: 0,
		external: 0,
		buffers: 0,
		total: 0,
	};
	samples = 0;

	constructor() {
		collect();
		this.base = usage();
	}

	/** Collects, then records what is reachable now */
	sample() {
		this.samples++;
		collect();
		const u = usage();
		// MEMORY_VERBOSE=1 prints each sample
		if (process.env.MEMORY_VERBOSE)
			console.log(
				`    sample ${this.samples}: heap ${mb(u.heap - this.base.heap)} external ${mb(u.external - this.base.external)} buffers ${mb(u.buffers - this.base.buffers)}`,
			);
		this.live = {
			heap: Math.max(this.live.heap, u.heap - this.base.heap),
			external: Math.max(this.live.external, u.external - this.base.external),
			buffers: Math.max(this.live.buffers, u.buffers - this.base.buffers),
			total: Math.max(this.live.total, total(u, this.base)),
		};
	}
}

/**
 * @param n Bytes
 * @returns MB with two decimals
 */
export const mb = (n: number) => (n / 1024 / 1024).toFixed(2);

/**
 * Runs a scenario several times, printing the largest live set sampled
 * (heap and memory outside it) and what stays reachable once the scenario
 * returns.
 *
 * @param name Scenario
 * @param fn Scenario, calls `peak.sample()` where it wants the live set
 * @param runs Times to run
 */
export async function scenario(
	name: string,
	fn: (peak: Peak) => Promise<unknown>,
	runs = 3,
) {
	const rows: string[] = [];
	for (let i = 0; i < runs; i++) {
		const peak = new Peak();
		await fn(peak);
		collect();
		const kept = usage();
		const retained = total(kept, peak.base);
		rows.push(
			`peak live ${mb(peak.live.total)} (heap ${mb(peak.live.heap)}, external ${mb(peak.live.external)}, arrayBuffers ${mb(peak.live.buffers)}, each its own max) | retained after ${mb(retained)} | ${peak.samples} samples`,
		);
	}
	console.log(`\n${name} (MB, ${runs} runs)`);
	for (const row of rows) console.log(`  ${row}`);
}

/**
 * Bytes allocated on the heap while `fn` runs, garbage included: the heap's
 * growth with no collection in between. Run with
 * `--max-semi-space-size=256` so the young generation is not collected
 * during a run; a run with a collection is reported as one.
 *
 * @param name Scenario
 * @param fn Work to measure
 * @param runs Times to run
 */
export async function allocated(
	name: string,
	fn: () => Promise<unknown>,
	runs = 5,
) {
	const { PerformanceObserver } = await import("node:perf_hooks");
	let collections = 0;
	const observer = new PerformanceObserver((list) => {
		collections += list.getEntries().length;
	});
	observer.observe({ entryTypes: ["gc"] });
	const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
	const rows: string[] = [];
	for (let i = 0; i < runs; i++) {
		// an ordinary collection: a last resort one shrinks the young
		// generation, which would then be collected during the run
		gc!();
		await tick();
		collections = 0;
		const before = process.memoryUsage().heapUsed;
		await fn();
		const after = process.memoryUsage().heapUsed;
		await tick();
		rows.push(
			collections
				? "collected during the run, not counted"
				: `${mb(after - before)} allocated`,
		);
	}
	observer.disconnect();
	console.log(`\n${name} (MB, ${runs} runs)`);
	for (const row of rows) console.log(`  ${row}`);
}
