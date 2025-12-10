import * as size from "@ovrjs/size";
import type { JSX } from "ovr";
import { version } from "ovr/package.json";

const Badge = (props: { href: string; children: JSX.Element }) => {
	return (
		<a
			href={props.href}
			class="button ghost px-2.5 font-mono text-xs no-underline"
			target="_blank"
		>
			{props.children}
		</a>
	);
};

export const Version = () => {
	return <Badge href="https://www.npmjs.com/package/ovr">ovr@{version}</Badge>;
};

export const Size = () => {
	return <Badge href="https://npmgraph.js.org/?q=ovr">{size.kb}KB</Badge>;
};
