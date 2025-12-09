import * as parallelContent from "@/server/demo/parallel/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import * as ovr from "ovr";

export const parallel = ovr.Route.get("/demo/parallel", (c) => {
	const Layout = createLayout(c);

	async function Delay({ ms }: { ms: number }) {
		await new Promise((res) => setTimeout(res, ms));
		return <div class="bg-muted rounded-md p-2">{ms}ms</div>;
	}

	function Delays() {
		const delays = Array.from({ length: 6 }, (_, i) => i * 100);
		return delays.map((ms) => <Delay ms={ms} />);
	}

	return (
		<Layout head={<Meta {...parallelContent.frontmatter} />}>
			<h1>{parallelContent.frontmatter.title}</h1>

			{ovr.Render.html(parallelContent.html)}

			<div class="grid grid-cols-3 gap-2 sm:grid-cols-6">
				<Delays />
			</div>

			<parallel.Anchor class="button ghost my-2 gap-3">
				<span class="icon-[lucide--rotate-cw]"></span> Refresh
			</parallel.Anchor>
		</Layout>
	);
});
