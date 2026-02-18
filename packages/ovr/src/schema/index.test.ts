import { Schema } from "./index.js";
import { describe, expect, test } from "vitest";

describe("Object shape methods", () => {
	test("object without shape validates plain objects", () => {
		const schema = Schema.object();
		const pass = schema.parse({ a: 1 });
		const fail = schema.parse([1]);

		if (pass.issues) throw new Error("Expected no issues");

		expect(pass.data).toEqual({ a: 1 });
		expect(fail.issues).toBeDefined();
	});

	test("pick keeps only selected keys", () => {
		const schema = Schema.object({
			a: Schema.string(),
			b: Schema.number(),
			c: Schema.boolean(),
		}).pick(["a", "c"]);

		const result = schema.parse({ a: "x", b: 1, c: true });

		if (result.issues) throw new Error("Expected no issues");

		expect(result.data).toEqual({ a: "x", c: true });
	});

	test("omit removes selected keys", () => {
		const schema = Schema.object({
			a: Schema.string(),
			b: Schema.number(),
			c: Schema.boolean(),
		}).omit(["b"]);

		const result = schema.parse({ a: "x", b: 1, c: true });

		if (result.issues) throw new Error("Expected no issues");

		expect(result.data).toEqual({ a: "x", c: true });
	});
});

describe("JSON schema", () => {
	test("parses valid JSON and validates inner schema", () => {
		const schema = Schema.json(
			Schema.object({ id: Schema.string(), expiration: Schema.number() }),
		);

		const result = schema.parse('{"id":"123","expiration":1}');

		if (result.issues) throw new Error("Expected no issues");

		expect(result.data).toEqual({ id: "123", expiration: 1 });
	});

	test("fails on invalid JSON strings", () => {
		const result = Schema.json(Schema.unknown()).parse("{");
		expect(result.issues).toBeDefined();
	});

	test("fails on non-string input", () => {
		const result = Schema.json(Schema.unknown()).parse(1);
		expect(result.issues).toBeDefined();
	});

	test("supports untyped parsing with Schema.unknown()", () => {
		const result = Schema.json(Schema.unknown()).parse('{"hello":"world"}');

		if (result.issues) throw new Error("Expected no issues");

		expect(result.data).toEqual({ hello: "world" });
	});

	test("does not swallow inner schema exceptions as JSON issues", () => {
		const schema = Schema.json(
			Schema.number().transform(() => {
				throw new Error("boom");
			}),
		);

		expect(() => schema.parse("1")).toThrowError("boom");
	});
});

describe("Form shape methods", () => {
	test("extend adds new fields", () => {
		const form = Schema.form({ a: Schema.Field.text() }).extend({
			b: Schema.Field.checkbox(),
		});
		const data = new FormData();

		data.set("a", "x");
		data.set("b", "on");

		const result = form.parse(data);

		if (result.issues) throw new Error("Expected no issues");

		expect(result.data).toEqual({ a: "x", b: true });
	});

	test("pick keeps only selected fields", () => {
		const form = Schema.form({
			a: Schema.Field.text(),
			b: Schema.Field.number(),
			c: Schema.Field.checkbox(),
		}).pick(["a", "c"]);
		const data = new FormData();

		data.set("a", "x");
		data.set("b", "1");
		data.set("c", "on");

		const result = form.parse(data);

		if (result.issues) throw new Error("Expected no issues");

		expect(result.data).toEqual({ a: "x", c: true });
	});

	test("pick keeps form field rendering helpers", () => {
		const form = Schema.form({
			a: Schema.Field.text(),
			b: Schema.Field.number(),
		}).pick(["a"]);

		expect(typeof form.Field).toBe("function");
		expect(typeof form.field({ name: "a" }).Control).toBe("function");
	});

	test("omit removes selected fields", () => {
		const form = Schema.form({
			a: Schema.Field.text(),
			b: Schema.Field.number(),
			c: Schema.Field.checkbox(),
		}).omit(["b"]);
		const data = new FormData();

		data.set("a", "x");
		data.set("b", "1");
		data.set("c", "on");

		const result = form.parse(data);

		if (result.issues) throw new Error("Expected no issues");

		expect(result.data).toEqual({ a: "x", c: true });
	});
});

describe("Form file fields", () => {
	test("Schema.Field.file parses a single File", () => {
		const schema = Schema.form({ upload: Schema.Field.file() });
		const formData = new FormData();
		const file = new File(["hello"], "hello.txt", { type: "text/plain" });

		formData.append("upload", file);

		const result = schema.parse(formData);
		if (result.issues) throw new Error("Expected no issues");
		const data = result.data;

		expect(data.upload).toBeInstanceOf(File);
		expect(data.upload.name).toBe("hello.txt");
	});

	test("Schema.Field.files parses multiple Files", () => {
		const schema = Schema.form({ uploads: Schema.Field.files() });
		const formData = new FormData();
		const first = new File(["one"], "one.txt", { type: "text/plain" });
		const second = new File(["two"], "two.txt", { type: "text/plain" });

		formData.append("uploads", first);
		formData.append("uploads", second);

		const result = schema.parse(formData);
		if (result.issues) throw new Error("Expected no issues");
		const data = result.data;

		expect(data.uploads).toHaveLength(2);
		expect(data.uploads[0]!.name).toBe("one.txt");
		expect(data.uploads[1]!.name).toBe("two.txt");
	});
});
