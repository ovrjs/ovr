import { src } from "client:script";

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
