import { Schema } from "./index.js";
import { describe, expect, test } from "vitest";

describe("JSON Schema audit regressions", () => {
	test("repeated numeric bounds preserve the strongest checks", () => {
		const schema = Schema.number().min(10).min(0).max(20).max(30);

		expect(schema.parse(5).issues).toBeDefined();
		expect(schema.parse(25).issues).toBeDefined();
		expect(schema.toJsonSchema()).toMatchObject({ minimum: 10, maximum: 20 });
	});

	test("repeated string bounds preserve the strongest checks", () => {
		const schema = Schema.string().min(3).min(1).max(5).max(10);

		expect(schema.parse("ab").issues).toBeDefined();
		expect(schema.parse("abcdef").issues).toBeDefined();
		expect(schema.toJsonSchema()).toMatchObject({ minLength: 3, maxLength: 5 });
	});

	test("checks after a transform do not constrain the untransformed input", () => {
		const schema = Schema.string()
			.transform((s) => s.repeat(2))
			.min(3);

		expect(schema.parse("ab").data).toBe("abab");
		expect(schema.toJsonSchema({ io: "input" }).minLength).toBeUndefined();
	});

	test("unknown object properties can be absent on both sides", () => {
		const schema = Schema.object({ value: Schema.unknown() });

		expect(schema.parse({}).data).toEqual({});
		expect(schema.toJsonSchema({ io: "input" }).required ?? []).not.toContain(
			"value",
		);
		expect(schema.toJsonSchema().required ?? []).not.toContain("value");
	});

	test("preprocessing may supply a missing input property", () => {
		const schema = Schema.object({
			value: Schema.string().preprocess((v) => v ?? "default"),
		});

		expect(schema.parse({}).data).toEqual({ value: "default" });
		expect(schema.toJsonSchema({ io: "input" }).required ?? []).not.toContain(
			"value",
		);
		expect(schema.toJsonSchema().required).toContain("value");
	});

	test("an undefined default does not make an output property required", () => {
		const schema = Schema.object({
			value: Schema.string().optional().default(undefined),
		});

		expect(schema.parse({}).data).toEqual({});
		expect(schema.toJsonSchema().required ?? []).not.toContain("value");
	});

	test("output constraints include defaults that bypass inner validation", () => {
		const schema = Schema.object({ value: Schema.number().min(10).default(0) });

		expect(schema.parse({}).data).toEqual({ value: 0 });
		// The inner minimum cannot constrain every output; the default is an alternative.
		expect(schema.toJsonSchema()).not.toHaveProperty(
			"properties.value.minimum",
			10,
		);
	});

	test("fractional string bounds become valid integer length keywords", () => {
		const schema = Schema.string().min(1.5).max(3.5);

		expect(schema.parse("ab").data).toBe("ab");
		expect(schema.toJsonSchema()).toMatchObject({ minLength: 2, maxLength: 3 });
	});
});
