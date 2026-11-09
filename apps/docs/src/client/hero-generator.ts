/** How many times faster the generator runs with the pointer at its center. */
const fastest = 8;

/** How far out, in radii from the center, the pointer starts to speed it up. */
const reach = 1.6;

/** How much of the way to its new speed the generator moves each frame. */
const ease = 0.06;

/**
 * Runs the generator faster as the pointer comes near it, spinning up and
 * winding down smoothly, like a machine taking on load.
 */
export class HeroGenerator extends HTMLElement {
	#rate = 1;
	#target = 1;
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
		document.documentElement.addEventListener("pointerleave", () =>
			this.#speed(1),
		);
	}

	/** Set the target speed from how close the pointer is to the center. */
	#near(event: PointerEvent) {
		const box = this.firstElementChild!.getBoundingClientRect();
		const radius = box.width / 2;
		const distance = Math.hypot(
			event.clientX - (box.left + radius),
			event.clientY - (box.top + radius),
		);
		const closeness = Math.max(0, 1 - distance / (radius * reach));

		this.#speed(1 + closeness ** 2 * (fastest - 1));
	}

	#speed(target: number) {
		this.#target = target;
		if (!this.#frame) this.#frame = requestAnimationFrame(() => this.#step());
	}

	/** Move the speed toward the target, a frame at a time, until it arrives. */
	#step() {
		this.#rate += (this.#target - this.#rate) * ease;
		if (Math.abs(this.#target - this.#rate) < 0.01) this.#rate = this.#target;

		// the rotor's spin and the coils' charge, which keep their phase
		for (const animation of this.getAnimations({ subtree: true }))
			animation.playbackRate = this.#rate;

		this.#frame =
			this.#rate === this.#target
				? 0
				: requestAnimationFrame(() => this.#step());
	}
}
