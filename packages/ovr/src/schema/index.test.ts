import { Schema } from "./index.js";
import { describe, expect, test } from "vitest";

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
