/**
 * The package under measurement: the built `ovr`, or another build's `dist`
 * directory given as `OVR_DIST`, to compare a change against what it
 * replaced.
 */
import type * as Ovr from "ovr";
import type * as Runtime from "ovr/jsx-runtime";

const dist = process.env.OVR_DIST;

export const ovr: typeof Ovr = await import(
	dist ? new URL(`file://${dist}/index.js`).href : "ovr"
);

export const runtime: typeof Runtime = await import(
	dist ? new URL(`file://${dist}/jsx-runtime.js`).href : "ovr/jsx-runtime"
);
