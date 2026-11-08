const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Replays the chunks rendered into it, as they streamed: the first part of
 * each pane, a pause while the query runs, then the rest.
 */
export class StreamDemo extends HTMLElement {
	/** Increments to stop a replay that is still running. */
	#run = 0;

	connectedCallback() {
		// fade the edges a pane can scroll past
		for (const pane of this.#panes()) {
			const edges = () => {
				pane.toggleAttribute("data-above", pane.scrollTop > 0);
				pane.toggleAttribute(
					"data-below",
					pane.scrollTop + pane.clientHeight < pane.scrollHeight - 1,
				);
			};
			pane.addEventListener("scroll", edges, { passive: true });
			new ResizeObserver(edges).observe(pane);
		}

		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

		const replay = this.querySelector<HTMLButtonElement>("[data-replay]")!;
		replay.hidden = false;
		replay.addEventListener("click", () => this.#play());

		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry?.isIntersecting) return;
				observer.disconnect();
				this.#play();
			},
			{ threshold: 0.3 },
		);
		// start when the output comes into view, the demo may be taller than the screen
		observer.observe(this.querySelector("[data-phase]")!.closest("pre")!);
	}

	/** The panes the chunks stream into. */
	#panes() {
		return [...this.querySelectorAll("pre")].filter((pre) =>
			pre.querySelector("[data-phase]"),
		);
	}

	async #play() {
		const run = ++this.#run;
		const panes = this.#panes();
		// the source line that waits, beside the demo and with it on small screens
		const waiting = document.querySelectorAll(
			`[data-line="${this.dataset.await}"]`,
		);

		// a replay starts over
		for (const old of this.querySelectorAll(".caret")) old.remove();
		for (const line of waiting) line.removeAttribute("data-waiting");

		for (const pane of panes) {
			// keep the size of the finished output, so the page doesn't move
			pane.style.minHeight = `${pane.clientHeight}px`;
			pane.scrollTop = 0;
			for (const chunk of pane.querySelectorAll("[data-phase]"))
				(chunk as HTMLElement).hidden = true;
		}

		const carets = panes.map((pane) => {
			const caret = document.createElement("span");
			caret.className = "caret";
			pane.querySelector("code")!.append(caret);
			return caret;
		});

		/**
		 * Show a phase's chunks over `ms`, each after the text before it.
		 */
		const phase = (n: number, ms: number) =>
			Promise.all(
				panes.map(async (pane, p) => {
					const chunks = [
						...pane.querySelectorAll<HTMLElement>(`[data-phase="${n}"]`),
					];
					const total = chunks.reduce(
						(sum, chunk) => sum + chunk.textContent!.length,
						0,
					);
					for (const chunk of chunks) {
						await wait((ms * chunk.textContent!.length) / total / 2);
						if (run !== this.#run) return;
						chunk.hidden = false;
						chunk.after(carets[p]!);
						// follow the stream, like a terminal
						pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
						await wait((ms * chunk.textContent!.length) / total / 2);
					}
				}),
			);

		await wait(400);
		if (run !== this.#run) return;
		await phase(0, 500);
		if (run !== this.#run) return;

		for (const line of waiting) line.setAttribute("data-waiting", "");
		await wait(1400);
		for (const line of waiting) line.removeAttribute("data-waiting");
		if (run !== this.#run) return;

		await phase(1, 1600);
		if (run !== this.#run) return;

		await wait(1200);
		if (run === this.#run) for (const caret of carets) caret.remove();
	}
}
