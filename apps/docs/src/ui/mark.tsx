import source from "@/assets/logo.svg?raw";
import * as o from "ovr";

/**
 * @param r Radius
 * @param deg Degrees clockwise from the top
 * @returns The point on the logo's circles
 */
const point = (r: number, deg: number) => {
	const rad = (deg * Math.PI) / 180;
	return `${(16 + r * Math.sin(rad)).toFixed(3)} ${(16 - r * Math.cos(rad)).toFixed(3)}`;
};

/**
 * The shroud ring in seven segments, one for every two blades, each a
 * filament down the middle of the ring that lights as the current comes
 * around.
 */
const coils = Array.from({ length: 7 }, (_, i) => {
	const from = (i * 360) / 7 + 3;
	const to = ((i + 1) * 360) / 7 - 3;

	return `<path data-coil style="--i: ${i}" d="M${point(13.5, from)}A13.5 13.5 0 0 1 ${point(13.5, to)}" fill="none" stroke-width="1" stroke-linecap="round" />`;
}).join("");

/**
 * The logo's turbine disc, drawn in the text color from the same source as
 * the favicon. Pointed at, the disc turns a blade's width while current runs
 * around the shroud ring.
 */
export const Mark = (props: { class?: string }) =>
	o.Markup.raw(
		source
			.replace("<svg ", `<svg aria-hidden="true" class="${props.class ?? ""}" `)
			.replace("</svg>", `${coils}</svg>`),
	);
