/** Center of the drawing. */
const c = 16;

/**
 * @param r Radius
 * @param deg Degrees clockwise from the top
 * @returns The point on the circle
 */
const point = (r: number, deg: number) => {
	const rad = (deg * Math.PI) / 180;
	return `${(c + r * Math.sin(rad)).toFixed(3)} ${(c - r * Math.cos(rad)).toFixed(3)}`;
};

/** Half the width of a stator tooth. */
const tooth = 1.1;

/** The stator's teeth, which the coils are wound between. */
const teeth = 8;

/** Radii of the coil windings between each pair of teeth. */
const windings = [9.4, 10.3, 11.2, 12.1, 13];

/**
 * The windings between two teeth, as arcs that stop at each tooth.
 *
 * @param i Which gap between the teeth, clockwise from the top
 */
const coil = (i: number) =>
	windings
		.map((r) => {
			// the tooth's half width as an angle at this radius
			const edge = (Math.asin(tooth / r) * 180) / Math.PI;
			const from = (i * 360) / teeth + edge;
			const to = ((i + 1) * 360) / teeth - edge;
			return `M${point(r, from)}A${r} ${r} 0 0 1 ${point(r, to)}`;
		})
		.join("");

/**
 * The logo's generator in more detail, large and faint behind the hero:
 * coils wound between the still stator's teeth light in turn as the rotor
 * spins inside them, across an air gap.
 */
export const Generator = () => (
	<svg
		viewBox="0 0 32 32"
		aria-hidden="true"
		class="hero-generator pointer-events-none absolute -top-24 -right-44 -z-10 size-[26rem] lg:-top-44 lg:-right-40 lg:size-[42rem]"
	>
		{/* stator: the casing, its teeth, and the coils between them */}
		<circle
			cx={c}
			cy={c}
			r="14.25"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
		/>
		{Array.from({ length: teeth }, (_, i) => (
			<rect
				x={c - tooth}
				y="2.4"
				width={tooth * 2}
				height="5"
				fill="currentColor"
				transform={`rotate(${(i * 360) / teeth} ${c} ${c})`}
			/>
		))}
		{Array.from({ length: teeth }, (_, i) => (
			<path
				data-coil
				style={`--i: ${i}`}
				d={coil(i)}
				fill="none"
				stroke="currentColor"
				stroke-width="0.35"
			/>
		))}

		{/* rotor, across the air gap from the teeth */}
		<g data-rotor fill="currentColor">
			<circle
				cx={c}
				cy={c}
				r="6.9"
				fill="none"
				stroke="currentColor"
				stroke-width="1.2"
			/>
			{Array.from({ length: 6 }, (_, i) => (
				<rect
					x={c - 0.45}
					y={c - 6.4}
					width="0.9"
					height="4.8"
					transform={`rotate(${i * 60} ${c} ${c})`}
				/>
			))}
			<path
				fill-rule="evenodd"
				d={`M${point(2, 0)}A2 2 0 1 1 ${point(2, 180)}A2 2 0 1 1 ${point(2, 0)}ZM${point(0.7, 0)}A0.7 0.7 0 1 1 ${point(0.7, 180)}A0.7 0.7 0 1 1 ${point(0.7, 0)}Z`}
			/>
		</g>
	</svg>
);
