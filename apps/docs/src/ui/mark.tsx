import source from "@/assets/logo.svg?raw";
import * as o from "ovr";

/**
 * The logo's generator, drawn in the text color from the same source as the
 * favicon.
 */
export const Mark = (props: { class?: string }) =>
	o.Markup.raw(
		source.replace(
			"<svg ",
			`<svg aria-hidden="true" class="${props.class ?? ""}" `,
		),
	);
