/** How many times faster the generator runs with the pointer at its center. */
const fast = 10;

/** How much faster again it spools up while the pointer stays near the center. */
const spooled = 24;

/** How far out, in radii from the center, the pointer starts to speed it up. */
const reach = 1.6;

/** How close, from 0 at the reach to 1 at the center, the pointer spools it up. */
const middle = 0.75;

/**
 * The coils charge no faster than this, so the current stays a quick wave
 * instead of flickering.
 */
const charge = 8;

/** How much of the way to its new speed the generator moves each frame. */
const ease = 0.06;

/**
 * Runs the generator faster as the pointer comes near it, and faster still
 * while it stays near the middle, spinning up and winding down smoothly, like
 * a machine taking on load.
 */
export class HeroGenerator extends HTMLElement {
	/** How close the pointer is, from 0 at the reach to 1 at the center. */
	#closeness = 0;

	/** How far it has spooled up with the pointer near the middle, from 0 to 1. */
	#spool = 0;

	#rate = 1;
	#frame = 0;

	connectedCallback() {
		if (
			matchMedia("(prefers-reduced-motion: reduce)").matches ||
			!matchMedia("(hover: hover)").matches
		)
			return;

		addEventListener("pointermove", (event) => this.#near(event), {
			passive: true,
		});
		document.documentElement.addEventListener("pointerleave", () => {
			this.#closeness = 0;
			this.#run();
		});
	}

	/** Measure how close the pointer is to the center. */
	#near(event: PointerEvent) {
		const box = this.getBoundingClientRect();
		const radius = box.width / 2;
		const distance = Math.hypot(
			event.clientX - (box.left + radius),
			event.clientY - (box.top + radius),
		);

		this.#closeness = Math.max(0, 1 - distance / (radius * reach));
		this.#run();
	}

	#run() {
		if (!this.#frame) this.#frame = requestAnimationFrame(() => this.#step());
	}

	/**
	 * Spool up or down, move the speed a step toward its target, and keep
	 * going until both settle.
	 */
	#step() {
		// about four seconds to spool up, and quicker to spool down
		this.#spool =
			this.#closeness >= middle
				? this.#spool + (1 - this.#spool) * 0.012
				: this.#spool * 0.95;
		if (this.#spool < 0.001) this.#spool = 0;
		if (this.#spool > 0.999) this.#spool = 1;

		const target =
			1 + this.#closeness ** 2 * (fast - 1) + this.#spool * (spooled - fast);
		this.#rate += (target - this.#rate) * ease;
		if (Math.abs(target - this.#rate) < 0.01) this.#rate = target;

		for (const animation of this.getAnimations({ subtree: true }))
			animation.playbackRate =
				// the spark rides the wave of charge, so it keeps the same pace
				animation instanceof CSSAnimation &&
				(animation.animationName === "charge" ||
					animation.animationName === "orbit")
					? Math.min(this.#rate, charge)
					: this.#rate;

		// the glow brightens with the load, from 0 at rest to 1 fully spooled
		this.style.setProperty(
			"--load",
			((this.#rate - 1) / (spooled - 1)).toFixed(3),
		);

		// settled once at its speed, fully spooled up or down
		this.#frame =
			this.#rate === target && (this.#spool === 0 || this.#spool === 1)
				? 0
				: requestAnimationFrame(() => this.#step());
	}
}
