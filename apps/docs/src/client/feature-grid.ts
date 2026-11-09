/**
 * Plays each feature's illustration once when it scrolls into view on touch
 * screens, which have no hover to play it.
 */
export class FeatureGrid extends HTMLElement {
	connectedCallback() {
		if (!matchMedia("(hover: none)").matches) return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					(entry.target as HTMLElement).dataset.played = "";
					observer.unobserve(entry.target);
				}
			},
			{ threshold: 0.6 },
		);

		for (const feature of this.querySelectorAll("[data-feature]"))
			observer.observe(feature);
	}
}
