/**
 * The logo's generator, faint behind the hero: the rotor turns inside the
 * still stator ring, and current runs around the ring.
 */
export const Generator = () => (
	<svg
		viewBox="0 0 32 32"
		aria-hidden="true"
		class="hero-generator pointer-events-none absolute top-1/2 right-0 -z-10 hidden size-72 -translate-y-1/2 lg:block"
	>
		<circle
			cx="16"
			cy="16"
			r="13.5"
			fill="none"
			stroke="currentColor"
			stroke-width="3"
		/>
		<circle
			data-current
			cx="16"
			cy="16"
			r="13.5"
			fill="none"
			stroke-width="3"
			pathLength="100"
			stroke-dasharray="8 92"
		/>
		<g data-rotor fill="currentColor">
			<circle
				cx="16"
				cy="16"
				r="6.5"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
			/>
			{[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
				<rect
					x="14.75"
					y="3"
					width="2.5"
					height="5.5"
					transform={`rotate(${angle} 16 16)`}
				/>
			))}
			<circle cx="16" cy="16" r="2" />
		</g>
	</svg>
);
