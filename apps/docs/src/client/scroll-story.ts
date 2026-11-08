/**
 * Lights up the lines of the source each step is about, and marks a step as
 * played once it reaches the middle of the screen, so its figure plays once
 * and stays finished as you scroll on.
 */
export class ScrollStory extends HTMLElement {
	connectedCallback() {
		const code = this.querySelector<HTMLElement>("[data-code]");
		const lines = [
			...this.querySelectorAll<HTMLElement>("[data-code] [data-line]"),
		];
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;

					const step = entry.target as HTMLElement;
					step.dataset.played = "";

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
