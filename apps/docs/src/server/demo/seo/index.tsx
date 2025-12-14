import * as seoContent from "@/server/demo/seo/index.md";
import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import * as ovr from "ovr";

export const seo = ovr.Route.get("/demo/seo", (c) => {
	const Layout = createLayout(c);

	return (
		<Layout head={<Meta {...seoContent.frontmatter} />}>
			<h1>{seoContent.frontmatter.title}</h1>
			{ovr.Render.html(seoContent.html)}
		</Layout>
	);
});
