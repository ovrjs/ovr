import { Parser } from "./index.js";
import { describe, expect, it } from "vitest";

// Adjust path as needed

// Helper to collect all parts into an array for easier assertion
async function collectParts(parser: Parser) {
	const parts = [];
	for await (const part of parser.data()) {
		parts.push(part);
		await part.parse();
	}
	return parts;
}

describe("MultipartParser", () => {
	it("should parse simple text fields", async () => {
		// 1. Construct the mock Request using standard FormData
		const formData = new FormData();
		formData.append("username", "alice");
		formData.append("role", "admin");

		const req = new Request("http://localhost:3000", {
			method: "POST",
			body: formData,
		});

		// 2. Run the parser
		const parser = new Parser(req);
		const parts = await collectParts(parser);

		// 3. Assertions
		expect(parts).toHaveLength(2);

		const usernamePart = parts.find((p) => p.name === "username");
		expect(usernamePart).toBeDefined();
		// Test the .parse() empty overload (raw string)
		expect(await usernamePart?.parse()).toBe("alice");

		const rolePart = parts.find((p) => p.name === "role");
		expect(await rolePart?.parse()).toBe("admin");
	});

	it("should support custom type coercion via .parse(fn)", async () => {
		const formData = new FormData();
		formData.append("age", "42");
		formData.append("isActive", "true");
		formData.append("settings", '{"theme":"dark"}');

		const req = new Request("http://localhost:3000", {
			method: "POST",
			body: formData,
		});

		const parser = new Parser(req);
		const parts = await collectParts(parser);

		// Test Number coercion
		const agePart = parts.find((p) => p.name === "age");
		const age = await agePart?.parse(Number);
		expect(age).toBe(42);
		expect(typeof age).toBe("number");

		// Test Boolean/Custom coercion
		const activePart = parts.find((p) => p.name === "isActive");
		const isActive = await activePart?.parse((val) => val === "true");
		expect(isActive).toBe(true);

		// Test JSON coercion
		const settingsPart = parts.find((p) => p.name === "settings");
		const settings = await settingsPart?.parse(JSON.parse);
		expect(settings).toEqual({ theme: "dark" });
	});

	it("should handle file uploads correctly", async () => {
		const formData = new FormData();

		// Create a mock file
		const fileContent = "Hello world, this is a text file.";
		const file = new File([fileContent], "hello.txt", { type: "text/plain" });

		formData.append("document", file);

		const req = new Request("http://localhost:3000", {
			method: "POST",
			body: formData,
		});

		const parser = new Parser(req);
		const parts = await collectParts(parser);

		expect(parts).toHaveLength(1);
		const filePart = parts[0];

		// Check Metadata
		expect(filePart.name).toBe("document");
		expect(filePart.filename).toBe("hello.txt");

		// Check Headers (Content-Type is usually preserved in multipart)
		expect(filePart.headers.get("content-type")).toBe("text/plain");

		// Check Body Content
		const content = await filePart.parse();
		expect(content).toBe(fileContent);
	});

	it("should handle a complex mix of files and fields", async () => {
		const formData = new FormData();
		formData.append("title", "My Vacation");

		const imageFile = new File(["(binary data mockup)"], "photo.png", {
			type: "image/png",
		});
		formData.append("upload", imageFile);

		formData.append("description", "A lovely trip.");

		const req = new Request("http://localhost:3000", {
			method: "POST",
			body: formData,
		});

		const parser = new Parser(req);
		const parts = await collectParts(parser);

		expect(parts).toHaveLength(3);

		// Verify order allows streaming (though FormData order isn't strictly guaranteed by spec,
		// usually it respects append order)
		expect(parts[0].name).toBe("title");
		expect(parts[1].filename).toBe("photo.png");
		expect(parts[2].name).toBe("description");
	});
});
