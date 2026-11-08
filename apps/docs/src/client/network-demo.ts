import * as network from "@/lib/network";

/**
 * Replays the page load drawn in it, streamed or buffered, when it comes into
 * view and when a mode is picked.
 */
export class NetworkDemo extends HTMLElement {
	#frame = 0;

	connectedCallback() {
		const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
		const modes = this.querySelector<HTMLElement>("[data-modes]")!;
		modes.hidden = false;

		for (const button of modes.querySelectorAll<HTMLButtonElement>(
			"[data-mode-button]",
		)) {
			button.addEventListener("click", () => {
				const mode = button.dataset.modeButton as network.Mode;
				if (still) this.#draw(mode, network.duration);
				else this.#play(mode);
			});
		}

		if (still) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry?.isIntersecting) return;
				observer.disconnect();
				this.#play("streamed");
			},
			{ threshold: 0.5 },
		);
		observer.observe(this);
	}

	#play(mode: network.Mode) {
		cancelAnimationFrame(this.#frame);
		this.toggleAttribute("data-playing", true);

		const start = performance.now();
		const tick = (now: number) => {
			const t = Math.min(network.duration, (now - start) / network.slowdown);
			this.#draw(mode, t);

			if (t < network.duration) this.#frame = requestAnimationFrame(tick);
			else this.removeAttribute("data-playing");
		};

		this.#frame = requestAnimationFrame(tick);
	}

	/** Draw the panel at `t` milliseconds into the load. */
	#draw(mode: network.Mode, t: number) {
		const frame = network.frame(mode, t);
		const timing = network.timings[mode];

		this.dataset.mode = mode;
		for (const button of this.querySelectorAll("[data-mode-button]"))
			button.setAttribute(
				"aria-pressed",
				String(button.getAttribute("data-mode-button") === mode),
			);

		for (const [i, request] of frame.requests.entries()) {
			const row = this.querySelector(`[data-request="${i}"]`)!;
			row.querySelector<HTMLElement>("[data-wait]")!.style.cssText =
				request.wait;
			row.querySelector<HTMLElement>("[data-load]")!.style.cssText =
				request.load;
		}

		const ticks = this.querySelectorAll<HTMLElement>("[data-chunk]");
		const response = this.querySelectorAll<HTMLElement>("[data-response]");
		for (const [i, chunk] of frame.chunks.entries()) {
			ticks[i]!.style.cssText = chunk.left;
			ticks[i]!.toggleAttribute("data-arrived", chunk.arrived);
			response[i]!.toggleAttribute("data-arrived", chunk.arrived);
		}

		const paint = this.querySelector<HTMLElement>("[data-paint]")!;
		paint.style.cssText = frame.paint.left;
		paint.toggleAttribute("data-shown", frame.paint.shown);

		this.querySelector<HTMLElement>("[data-playhead]")!.style.cssText =
			frame.playhead;

		this.querySelector("[data-paint-time]")!.textContent = frame.paint.shown
			? `${timing.paint} ms`
			: "…";
		this.querySelector("[data-finish-time]")!.textContent = frame.finished
			? `${timing.finish} ms`
			: "…";
	}
}
