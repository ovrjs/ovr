const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Replays the chunks rendered into it, as they streamed: the first part of
 * each pane, a pause while the query runs, then the rest.
 */
export class StreamDemo extends HTMLElement {
	/** Increments to stop a replay that is still running. */
	#run = 0;

	connectedCallback() {
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
		observer.observe(this.querySelector("figure")!);
	}

	async #play() {
		const run = ++this.#run;
		const panes = [...this.querySelectorAll("figure pre")];
		const line = [...this.querySelectorAll(".line")].find((line) =>
			line.textContent?.includes("await"),
		);

		// a replay starts over
		for (const old of this.querySelectorAll(".caret")) old.remove();
		line?.removeAttribute("data-waiting");

		for (const pane of panes) {
			// keep the size of the finished output, so the page doesn't move
			(pane as HTMLElement).style.minHeight = `${pane.clientHeight}px`;
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
						await wait((ms * chunk.textContent!.length) / total / 2);
					}
				}),
			);

		await wait(400);
		if (run !== this.#run) return;
		await phase(0, 500);
		if (run !== this.#run) return;

		line?.setAttribute("data-waiting", "");
		await wait(1400);
		line?.removeAttribute("data-waiting");
		if (run !== this.#run) return;

		await phase(1, 1600);
		if (run !== this.#run) return;

		await wait(1200);
		if (run === this.#run) for (const caret of carets) caret.remove();
	}
}
