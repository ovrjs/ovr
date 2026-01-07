import { type Middleware, Render, Route } from "ovr";
import { z } from "zod";

// Validate the credential coming from the browser
const BrowserCredentialSchema = z.object({ id: z.string() }).loose();

// TODO: Implement these in your application
async function storeCredential(_credential: any) {}
async function getCredential(_id: string): Promise<any> {
	return {} as any;
}

// Parse and validate credential from form data
async function parseCredential(c: Middleware.Context) {
	const value = (await c.form().data()).get("credential");

	if (typeof value === "string") {
		try {
			return BrowserCredentialSchema.parse(JSON.parse(value));
		} catch {}
	}

	return null;
}

export const register = Route.get("/register", async (c) => {
	const user = { id: `user-${crypto.randomUUID()}` };

	const passkey = await c.auth.passkey.create({
		id: user.id,
		name: `user-${user.id}`,
		displayName: "Account",
	});

	return (
		<>
			<h1>Create account</h1>

			<registerVerify.Form>
				<button>Create passkey</button>
			</registerVerify.Form>

			<WebAuthn route={registerVerify} method="create" passkey={passkey} />
		</>
	);
});

export const registerVerify = Route.post(async (c) => {
	const credential = await parseCredential(c);

	if (!credential) return c.text("Invalid request", 400);

	const verified = await c.auth.passkey.verify(credential);

	await storeCredential(verified);

	c.redirect("/login", 303);
});

export const login = Route.get("/login", async (c) => {
	const passkey = await c.auth.passkey.get();

	return (
		<>
			<h1>Sign in</h1>

			<loginVerify.Form>
				<button>Sign in with passkey</button>
			</loginVerify.Form>

			<WebAuthn route={loginVerify} method="get" passkey={passkey} />
		</>
	);
});

export const loginVerify = Route.post(async (c) => {
	const credential = await parseCredential(c);

	if (!credential) return c.text("Invalid request", 400);

	const stored = await getCredential(credential.id);

	const result = await c.auth.passkey.assert(credential, stored);

	await c.auth.login(result.userId);

	c.redirect("/", 303);
});

const WebAuthn = (props: {
	route: Route;
	method: "create" | "get";
	passkey: unknown;
}) => (
	<>
		<script type="module">
			{Render.html(`
document
	.querySelector('form[action="${props.route.url()}"]')
	.addEventListener("submit", async (e) => {
		e.preventDefault();
		const credential = await navigator.credentials.${props.method}({ publicKey: ${JSON.stringify(props.passkey)} });
		const input = document.createElement("input");
		input.type = "hidden";
		input.name = "credential";
		input.value = JSON.stringify(credential.toJSON());
		e.currentTarget.appendChild(input);
		e.currentTarget.submit();
	});
`)}
		</script>
		<noscript>JavaScript is required for authentication.</noscript>
	</>
);
