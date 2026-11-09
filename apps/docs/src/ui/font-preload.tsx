import { src } from "client:style";

/** Preload the fonts the stylesheet uses, so text renders in them from the start. */
export const FontPreload = () =>
	src.assets.map((path) => (
		<link
			rel="preload"
			href={`/${path}`}
			as="font"
			type="font/woff2"
			crossorigin
		/>
	));
