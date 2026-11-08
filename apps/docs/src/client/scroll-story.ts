/**
 * Lights up the lines of the source each step is about, and marks the step
 * in the middle of the screen as active so its figure plays.
 */
export class ScrollStory extends HTMLElement {
	connectedCallback() {
		const lines = [
			...this.querySelectorAll<HTMLElement>("[data-code] [data-line]"),
		];
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const step = entry.target as HTMLElement;

					if (!entry.isIntersecting) {
						delete step.dataset.active;
						continue;
					}

					step.dataset.active = "";

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
				}
			},
			// a step is active while it crosses the middle of the screen
			{ rootMargin: "-45% 0px -45% 0px" },
		);

		for (const step of this.querySelectorAll("[data-step]"))
			observer.observe(step);

		this.dataset.ready = "";
	}
}
