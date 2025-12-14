---
title: SEO
description: Create basic routes for SEO with ovr XML rendering.
---

ovr can be used to generate XML directly with JSX. Here's an example of a simple SEO module containing [`/sitemap.xml`](/sitemap.xml), [`/robots.txt`](/robots.txt), and `/favicon.ico` routes.

```tsx
// seo.tsx
import * as content from "@/lib/content";
import { logo } from "@/lib/logo";
import { Route } from "ovr";

const siteOrigin = "https://ovrjs.com";

export const sitemap = Route.get("/sitemap.xml", (c) => {
	c.res.headers.set("content-type", "application/xml; charset=utf-8");

	return (
		<>
			{/* ovr automatically adds question marks <?xml ... ?> to the declaration tag */}
			<xml version="1.0" encoding="utf-8" />
			<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
				<url>
					<loc>{siteOrigin}</loc>
				</url>
				{content.slugs(true).map((slug) => (
					<url>
						<loc>{`${siteOrigin}/${slug}`}</loc>
					</url>
				))}
			</urlset>
		</>
	);
});

// allows all robots and points to the sitemap
export const robots = Route.get("/robots.txt", (c) =>
	c.text(
		`User-agent: *\nDisallow:\n\nSitemap: ${siteOrigin}${sitemap.pathname()}`,
	),
);

// prevents 404 if icon is named something else
export const favicon = Route.get("/favicon.ico", (c) => c.redirect(logo.black));
```
