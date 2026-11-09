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
 * The gaps between the logo's spokes, from its rotor ring to its outer ring,
 * which charge in turn like the hero's coils.
 */
const coils = Array.from({ length: 8 }, (_, i) => {
	const inner = 7.75;
	const outer = 12;
	// the spokes are 2.5 wide, so each gap stops at a spoke's edge
	const edge = (r: number) => (Math.asin(1.25 / r) * 180) / Math.PI;
	const from = (r: number) => i * 45 + edge(r);
	const to = (r: number) => (i + 1) * 45 - edge(r);

	return `<path data-coil style="--i: ${i}" d="M${point(inner, from(inner))}L${point(outer, from(outer))}A${outer} ${outer} 0 0 1 ${point(outer, to(outer))}L${point(inner, to(inner))}A${inner} ${inner} 0 0 0 ${point(inner, from(inner))}Z" />`;
}).join("");

/**
 * The logo's generator, drawn in the text color from the same source as the
 * favicon, with coils that charge when the link is pointed at.
 */
export const Mark = (props: { class?: string }) =>
	o.Markup.raw(
		source
			.replace("<svg ", `<svg aria-hidden="true" class="${props.class ?? ""}" `)
			.replace("</svg>", `${coils}</svg>`),
	);
