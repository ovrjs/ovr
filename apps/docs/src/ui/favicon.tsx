import { logo } from "@/lib/logo";

export const FavIcon = () => (
	<>
		<link
			rel="icon"
			type="image/png"
			href={logo.black}
			media="(prefers-color-scheme: light)"
		/>
		<link
			rel="icon"
			type="image/png"
			href={logo.white}
			media="(prefers-color-scheme: dark)"
		/>
	</>
);
