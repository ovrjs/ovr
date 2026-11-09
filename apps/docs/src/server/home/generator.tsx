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

/** Half the width of a rotor spoke. */
const spoke = 0.45;

/** Radius of the rounding where a spoke meets the hub or the rotor ring. */
const fillet = 0.3;

/**
 * The rounded inside corners where each spoke meets the hub and the rotor
 * ring, as small shapes filling each corner up to a concave arc.
 */
const fillets = Array.from({ length: 6 }, (_, i) => {
	const angle = (i * Math.PI) / 3;
	// a point across (u) and along (v) the spoke, from the center
	const at = (u: number, v: number) =>
		[
			c + u * Math.cos(angle) + v * Math.sin(angle),
			c + u * Math.sin(angle) - v * Math.cos(angle),
		] as const;
	const xy = ([x, y]: readonly [number, number]) =>
		`${x.toFixed(3)} ${y.toFixed(3)}`;

	return [-1, 1]
		.flatMap((side) =>
			// the hub's edge, which the spoke leaves, and the ring's inner edge, which it meets
			[
				{ r: 2, out: 1 },
				{ r: 6.3, out: -1 },
			].map(({ r, out }) => {
				const u = spoke + fillet;
				const v = Math.sqrt((r + out * fillet) ** 2 - u ** 2);
				const center = at(side * u, v);
				const onSpoke = at(side * spoke, v);
				const scale = r / (r + out * fillet);
				const onCircle = at(side * u * scale, v * scale);
				const corner = at(side * spoke, Math.sqrt(r ** 2 - spoke ** 2));
				// the short way around the fillet's circle, from the spoke to the circle
				const turn =
					Math.atan2(onCircle[1] - center[1], onCircle[0] - center[0]) -
					Math.atan2(onSpoke[1] - center[1], onSpoke[0] - center[0]);
				const sweep = Math.sin(turn) > 0 ? 1 : 0;
				return `M${xy(corner)}L${xy(onSpoke)}A${fillet} ${fillet} 0 0 ${sweep} ${xy(onCircle)}Z`;
			}),
		)
		.join("");
}).join("");

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
			<path d={coil(i)} fill="none" stroke="currentColor" stroke-width="0.35" />
		))}
		{/* the charge, over each coil, fading in and out */}
		{Array.from({ length: teeth }, (_, i) => (
			<path
				data-coil
				style={`--i: ${i}`}
				d={coil(i)}
				fill="none"
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
					x={c - spoke}
					y={c - 6.4}
					width={spoke * 2}
					height="4.8"
					transform={`rotate(${i * 60} ${c} ${c})`}
				/>
			))}
			<path d={fillets} />
			<path
				fill-rule="evenodd"
				d={`M${point(2, 0)}A2 2 0 1 1 ${point(2, 180)}A2 2 0 1 1 ${point(2, 0)}ZM${point(0.7, 0)}A0.7 0.7 0 1 1 ${point(0.7, 180)}A0.7 0.7 0 1 1 ${point(0.7, 0)}Z`}
			/>
		</g>
	</svg>
);
