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

/** How much smaller the rotor is than the logo's turbine disc. */
const scale = 6.9 / 13.5;

/**
 * The rotor's blades, the logo's 14 at the rotor's size: short curves from
 * the disc's edge to its shroud ring.
 */
const blades = Array.from({ length: 14 }, (_, i) => {
	const at = (i * 360) / 14;
	return `M${point(7.6 * scale, at)}Q${point(10.3 * scale, at + 3)} ${point(13 * scale, at + 16)}`;
}).join("");

/** A disc with a shaft hole, as one even-odd path. */
const disc = (r: number, hole: number) =>
	`M${point(r, 0)}A${r} ${r} 0 1 1 ${point(r, 180)}A${r} ${r} 0 1 1 ${point(r, 0)}Z` +
	`M${point(hole, 0)}A${hole} ${hole} 0 1 1 ${point(hole, 180)}A${hole} ${hole} 0 1 1 ${point(hole, 0)}Z`;

/**
 * The logo's generator in more detail, large and faint behind the hero:
 * coils wound between the still stator's teeth light in turn as the rotor
 * spins inside them, across an air gap.
 */
export const Generator = () => (
	// runs faster as the pointer comes near it
	<hero-generator
		aria-hidden="true"
		class="hero-generator pointer-events-none absolute -top-24 -right-44 -z-10 block size-[26rem] lg:-top-44 lg:-right-40 lg:size-[42rem]"
	>
		{/* the light it gives off, spreading past the drawing */}
		<span data-glow class="absolute -inset-1/4 block rounded-full" />
		<svg viewBox="0 0 32 32" class="relative block size-full overflow-visible">
			<defs>
				<radialGradient id="spark">
					{/* styles, since presentation attributes can't read variables */}
					<stop offset="0" style="stop-color: white" />
					<stop offset="0.15" style="stop-color: var(--spark)" />
					<stop
						offset="0.45"
						style="stop-color: var(--spark); stop-opacity: 0.25"
					/>
					<stop offset="1" style="stop-color: var(--spark); stop-opacity: 0" />
				</radialGradient>
			</defs>
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
					d={coil(i)}
					fill="none"
					stroke="currentColor"
					stroke-width="0.35"
				/>
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

			{/* rotor, the logo's turbine disc, across the air gap from the teeth */}
			<g data-rotor fill="currentColor">
				<circle
					cx={c}
					cy={c}
					r="6.9"
					fill="none"
					stroke="currentColor"
					stroke-width="1.2"
				/>
				<path d={blades} fill="none" stroke="currentColor" stroke-width="0.6" />
				<path fill-rule="evenodd" d={disc(8.2 * scale, 2.2 * scale)} />
			</g>

			{/* the current, a spark going around the coils as they charge */}
			<g data-spark>
				<circle cx={c} cy={c - 11.2} r="3.2" fill="url(#spark)" />
			</g>
		</svg>
	</hero-generator>
);
