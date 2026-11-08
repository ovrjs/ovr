/** Size of a cell of the graph paper, matching `.paper-grid`. */
const cell = 28;

/** How long a cell takes to fade after it streams in. */
const fade = 2400;

/**
 * Streams the graph paper behind it: cells fill in reading order a chunk at a
 * time, pausing now and then as if awaiting, and fade as the rest arrive.
 */
export class StreamGrid extends HTMLElement {
	#canvas = document.createElement("canvas");
	#context = this.#canvas.getContext("2d")!;
	#columns = 0;
	#rows = 0;

	/** Cells streamed in, by index, with the time each arrived. */
	#cells = new Map<number, number>();

	/** The next cell to stream. */
	#next = 0;

	/** When the next chunk arrives. */
	#due = 0;

	#frame = 0;

	/** The ink, read again with each chunk so it follows the color scheme. */
	#color = "";

	connectedCallback() {
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

		this.#canvas.className = "absolute inset-0 size-full";
		this.append(this.#canvas);

		new ResizeObserver(() => this.#resize()).observe(this);

		// only draw while the grid is on screen
		new IntersectionObserver(([entry]) => {
			cancelAnimationFrame(this.#frame);
			if (entry?.isIntersecting)
				this.#frame = requestAnimationFrame(this.#draw);
		}).observe(this);
	}

	#resize() {
		const { width, height } = this.getBoundingClientRect();
		const ratio = devicePixelRatio;

		this.#canvas.width = width * ratio;
		this.#canvas.height = height * ratio;
		this.#context.scale(ratio, ratio);
		this.#columns = Math.ceil(width / cell);
		// the paper's mask hides the rows below this
		this.#rows = Math.ceil((height * 0.7) / cell);
	}

	#draw = (now: number) => {
		this.#frame = requestAnimationFrame(this.#draw);
		if (!this.#columns) return;

		if (now >= this.#due) {
			// a chunk of a few cells, then the next one soon, or a wait
			const size = 1 + Math.floor(Math.random() * 5);
			for (let i = 0; i < size; i++) {
				this.#cells.set(this.#next, now);
				this.#next = (this.#next + 1) % (this.#columns * this.#rows);
			}
			this.#color = getComputedStyle(this).color;
			this.#due = now + (Math.random() < 0.08 ? 700 + Math.random() * 900 : 90);
		}

		const context = this.#context;
		context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
		context.fillStyle = this.#color;

		for (const [index, time] of this.#cells) {
			const age = (now - time) / fade;
			if (age >= 1) {
				this.#cells.delete(index);
				continue;
			}

			context.globalAlpha = 0.07 * (1 - age) ** 2;
			context.fillRect(
				(index % this.#columns) * cell + 1,
				Math.floor(index / this.#columns) * cell + 1,
				cell - 1,
				cell - 1,
			);
		}
	};
}
