import type * as o from "ovr";

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

/**
 * @param r Radius
 * @returns A full circle as a path, to join with others
 */
const ring = (r: number) =>
	`M${point(r, 0)}A${r} ${r} 0 1 1 ${point(r, 180)}A${r} ${r} 0 1 1 ${point(r, 0)}Z`;

/**
 * @param r Radius of the hole
 * @param at Radius of the circle the hole sits on
 * @param deg Degrees clockwise from the top
 * @returns A small round hole as a path
 */
const hole = (r: number, at: number, deg: number) => {
	const [x, y] = point(at, deg).split(" ").map(Number) as [number, number];
	return `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
};

/** The sections of the stator that charge in turn, 45° each. */
const sections = 8;

/** Winding slots in each section. */
const slotsPer = 6;

/** Radius the spark and its light travel around, the middle of the slots. */
const orbit = 11.3;

/**
 * One winding slot through the stator's laminations, with rounded ends.
 *
 * @param at Degrees clockwise from the top of the slot's center line
 */
const slot = (at: number) => {
	const [inner, outer, half] = [9.3, 13.3, 0.3];
	const angle = (r: number) => (Math.asin(half / r) * 180) / Math.PI;
	return (
		`M${point(inner, at - angle(inner))}L${point(outer, at - angle(outer))}` +
		`A${half} ${half} 0 0 1 ${point(outer, at + angle(outer))}` +
		`L${point(inner, at + angle(inner))}` +
		`A${half} ${half} 0 0 1 ${point(inner, at - angle(inner))}Z`
	);
};

/**
 * The slots of one section, which fill with charge together.
 *
 * @param i Which section, clockwise from the top
 */
const section = (i: number) =>
	Array.from({ length: slotsPer }, (_, j) =>
		slot(((i * slotsPer + j + 0.5) * 360) / (sections * slotsPer)),
	).join("");

const slots = Array.from({ length: sections }, (_, i) => section(i)).join("");

/** The casing's bolt holes, between its two edges. */
const bolts = Array.from({ length: 16 }, (_, i) =>
	hole(0.22, 15.25, i * 22.5 + 11.25),
).join("");

/** The rotor's 40 fine turbine blades, curving from its web to its rim. */
const blades = Array.from({ length: 40 }, (_, i) => {
	const at = i * 9;
	return `M${point(5.35, at)}Q${point(6.7, at + 3)} ${point(7.9, at + 13)}`;
}).join("");

/** The hub's bolt circle. */
const hubBolts = Array.from({ length: 8 }, (_, i) =>
	hole(0.17, 1.55, i * 45 + 22.5),
).join("");

/**
 * The machine's linework: the still casing and stator, and the turbine rotor
 * spinning inside them across the air gap.
 */
const Machine = (props: { class?: string; mask?: string }) => (
	<g {...props} fill="none" stroke="currentColor">
		{/* casing, with its bolt holes */}
		<path d={ring(15.25)} stroke-width="0.9" />
		<path d={bolts} stroke="none" data-bolts />
		<path d={ring(14.55)} stroke-width="0.08" />

		{/* stator: the laminated ring and its winding slots */}
		<path d={ring(14.15) + ring(8.75)} stroke-width="0.12" />
		<path d={slots} stroke-width="0.08" />

		{/* rotor, across the air gap */}
		<g data-rotor>
			<path d={ring(8.05)} stroke-width="0.16" />
			<path d={blades} stroke-width="0.1" />
			<path d={ring(5.25) + ring(3.4)} stroke-width="0.12" />
			<path d={ring(2.15)} stroke-width="0.16" />
			<path d={hubBolts} stroke-width="0.07" />
			<path d={ring(0.75)} stroke-width="0.14" />
			{/* the keyway in the shaft bore */}
			<path
				d={`M${point(0.75, -8)}L${point(1.05, -6)}L${point(1.05, 6)}L${point(0.75, 8)}`}
				stroke-width="0.1"
			/>
		</g>
	</g>
);

/** Goes around the stator in step with the charge. */
const Orbiting = (props: { children: o.JSX.Element }) => (
	<g data-orbit>{props.children}</g>
);

/**
 * The logo's generator as a lit technical drawing, large behind the hero:
 * winding slots through the still stator charge in turn as a spark goes
 * around, lighting the metal near it, while the turbine rotor spins inside.
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
				{/* styles, since presentation attributes can't read variables */}
				<radialGradient id="spark">
					<stop offset="0" style="stop-color: white" />
					<stop offset="0.15" style="stop-color: var(--spark)" />
					<stop
						offset="0.45"
						style="stop-color: var(--spark); stop-opacity: 0.25"
					/>
					<stop offset="1" style="stop-color: var(--spark); stop-opacity: 0" />
				</radialGradient>
				<radialGradient id="falloff">
					<stop offset="0" style="stop-color: white" />
					<stop offset="0.35" style="stop-color: white; stop-opacity: 0.5" />
					<stop offset="1" style="stop-color: white; stop-opacity: 0" />
				</radialGradient>
				{/* where the spark's light reaches */}
				<mask
					id="light"
					maskUnits="userSpaceOnUse"
					x="-8"
					y="-8"
					width="48"
					height="48"
				>
					<Orbiting>
						<circle cx={c} cy={c - orbit} r="9" fill="url(#falloff)" />
					</Orbiting>
				</mask>
			</defs>

			{/* the slots, faintly filled, and charged in turn */}
			<path d={slots} data-slots />
			{Array.from({ length: sections }, (_, i) => (
				<path data-coil style={`--i: ${i}`} d={section(i)} />
			))}

			<Machine />
			{/* the same lines, bright where the spark lights them */}
			<Machine class="lit" mask="url(#light)" />

			{/* the current itself */}
			<Orbiting>
				<g data-spark>
					<circle cx={c} cy={c - orbit} r="3.2" fill="url(#spark)" />
				</g>
			</Orbiting>
		</svg>
	</hero-generator>
);
