import { createLayout } from "@/ui/layout";
import { Meta } from "@/ui/meta";
import * as o from "ovr";

/** Reports an error from anything after it, and shows a page in its place. */
export const error: o.Middleware = async (c, next) => {
	try {
		await next();
	} catch (error) {
		console.error(error);

		c.res.status = 500;
		// a type the route set before it failed, such as XML
		c.res.headers.delete("content-type");

		const Layout = createLayout(c);

		return (
			<Layout
				head={
					<Meta
						title="Something went wrong"
						description="The page could not be shown."
					/>
				}
			>
				<h1>Something went wrong</h1>

				<p>
					<a href="/">Return home</a>
				</p>
			</Layout>
		);
	}
};
