const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a finished figure rests before it plays again. */
const rest = 2500;

/** How much faster than it played a figure rewinds before playing again. */
const rewind = 6;

/**
 * Lights up the lines of the source each step is about, and marks a step as
 * played once it reaches the middle of the screen. Its figure plays again
 * while it stays there, and stays finished as you scroll on.
 */
export class ScrollStory extends HTMLElement {
	/** The step in the middle of the screen. */
	#current: HTMLElement | undefined;

	connectedCallback() {
		const code = this.querySelector<HTMLElement>("[data-code]");
		const lines = [
			...this.querySelectorAll<HTMLElement>("[data-code] [data-line]"),
		];
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const step = entry.target as HTMLElement;

					if (!entry.isIntersecting) {
						if (this.#current === step) this.#current = undefined;
						continue;
					}

					step.dataset.played = "";
					this.#current = step;
					this.#loop(step);

					const ranges = step.dataset
						.lines!.split(",")
						.map((range) => range.split("-").map(Number));

					for (const line of lines) {
						const n = Number(line.dataset.line);
						line.toggleAttribute(
							"data-lit",
							ranges.some(([from, to]) => n >= from! && n <= to!),
						);
					}

					if (code)
						this.#reveal(
							code,
							lines.filter((line) => line.hasAttribute("data-lit")),
						);
				}
			},
			// a step is current while it crosses the middle of the screen
			{ rootMargin: "-45% 0px -45% 0px" },
		);

		for (const step of this.querySelectorAll("[data-step]"))
			observer.observe(step);

		this.dataset.ready = "";
	}

	/** Play the step's figure again each time it finishes, while it is current. */
	async #loop(step: HTMLElement) {
		if (step.dataset.looping !== undefined) return;
		step.dataset.looping = "";

		while (this.#current === step) {
			const animations = step.getAnimations({ subtree: true });
			// nothing moves, as with reduced motion
			if (!animations.length) break;

			await Promise.all(animations.map((animation) => animation.finished));
			await wait(rest);
			if (this.#current !== step) break;

			// rewind quickly, instead of jumping back to the start
			for (const animation of animations) {
				animation.playbackRate = -rewind;
				animation.play();
			}
			await Promise.all(animations.map((animation) => animation.finished));

			for (const animation of animations) animation.playbackRate = 1;
			// a step scrolled past stays finished
			if (this.#current !== step) {
				for (const animation of animations) animation.finish();
				break;
			}
			for (const animation of animations) animation.play();
		}

		delete step.dataset.looping;
	}

	/**
	 * Scroll the source to the lit lines: all of them when they fit, or else
	 * the last range, which is the one the step is about.
	 */
	#reveal(code: HTMLElement, lit: HTMLElement[]) {
		const first = lit[0];
		const last = lit.at(-1);
		if (!first || !last) return;

		const top = (line: HTMLElement) =>
			line.getBoundingClientRect().top -
			code.getBoundingClientRect().top +
			code.scrollTop;
		const bottom = top(last) + last.offsetHeight;
		const fits = bottom - top(first) <= code.clientHeight - 32;

		code.scrollTo({
			top: fits
				? (top(first) + bottom - code.clientHeight) / 2
				: bottom - code.clientHeight + 16,
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
		});
	}
}
