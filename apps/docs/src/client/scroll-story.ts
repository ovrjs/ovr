/**
 * Lights up the lines of the source each step is about, and marks a step as
 * played once it reaches the middle of the screen, so its figure plays once
 * and stays finished as you scroll on.
 */
export class ScrollStory extends HTMLElement {
	connectedCallback() {
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
				}
			},
			// a step is current while it crosses the middle of the screen
			{ rootMargin: "-45% 0px -45% 0px" },
		);

		for (const step of this.querySelectorAll("[data-step]"))
			observer.observe(step);

		this.dataset.ready = "";
	}
}
