import { Field, Form } from "../form/index.js";
import { Schema } from "./index.js";
import { describe, expect, test } from "vitest";

type FormValid<S extends Field.Shape> = Extract<
	Form.Parse.Result<S>,
	{ data: Form.Parse.Data<S> }
>;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type Assert<T extends true> = T;

const valid = <T>(result: Schema.Parse.Result<T>): T => {
	if ("issues" in result) throw new Error("Expected no issues");
	return result.data;
};

const invalid = <T>(result: Schema.Parse.Result<T>) => {
	if (!result.issues) throw new Error("Expected issues");
	return result.issues;
};

const formValid = <S extends Field.Shape>(result: Form.Parse.Result<S>) => {
	if (result.issues) throw new Error("Expected no issues");
	return result as FormValid<S>;
};

describe("Schema core", () => {
	test("unknown passes through values", () => {
		const input = { hello: "world" };
		const result = Schema.unknown().parse(input);

		expect(valid(result)).toBe(input);
	});

	test("issue toString includes nested path", () => {
		const issue = new Schema.Issue("number", ["user", "age", 0]);

		expect(issue.toString()).toBe("Schema.Issue(user.age[0]): Expected number");
	});

	test("~standard validate returns value on success", () => {
		const result = Schema.number()["~standard"].validate(10);

		expect(result).toEqual({ value: 10 });
	});

	test("~standard validate returns issues on failure", () => {
		const result = Schema.number()["~standard"].validate("10");

		expect("issues" in result).toBe(true);
	});
});

describe("Primitive schemas", () => {
	test("string validates type", () => {
		expect(valid(Schema.string().parse("a"))).toBe("a");
		expect(invalid(Schema.string().parse(1))[0]?.expected).toBe("string");
	});

	test("boolean validates type", () => {
		expect(valid(Schema.boolean().parse(true))).toBe(true);
		expect(invalid(Schema.boolean().parse("true"))[0]?.expected).toBe(
			"boolean",
		);
	});

	test("number validates finite number and rejects non-finite values", () => {
		expect(valid(Schema.number().parse(1))).toBe(1);
		expect(invalid(Schema.number().parse(NaN))[0]?.expected).toBe("number");
		expect(invalid(Schema.number().parse(Infinity))[0]?.expected).toBe(
			"number",
		);
		expect(invalid(Schema.number().parse(-Infinity))[0]?.expected).toBe(
			"number",
		);
	});

	test("int validates safe integers", () => {
		expect(valid(Schema.number().int().parse(10))).toBe(10);
		expect(invalid(Schema.number().int().parse(10.5))[0]?.expected).toBe(
			"refine",
		);
	});

	test("string min and max validate length", () => {
		const schema = Schema.string().min(2).max(4);

		expect(valid(schema.parse("ab"))).toBe("ab");
		expect(valid(schema.parse("abcd"))).toBe("abcd");
		expect(invalid(schema.parse("a"))[0]?.expected).toBe("refine");
		expect(invalid(schema.parse("abcde"))[0]?.expected).toBe("refine");
	});

	test("number min and max validate bounds", () => {
		const schema = Schema.number().min(1).max(3);

		expect(valid(schema.parse(1))).toBe(1);
		expect(valid(schema.parse(3))).toBe(3);
		expect(invalid(schema.parse(0))[0]?.expected).toBe("refine");
		expect(invalid(schema.parse(4))[0]?.expected).toBe("refine");
	});

	test("bigint validates type", () => {
		expect(valid(Schema.bigint().parse(1n))).toBe(1n);
		expect(invalid(Schema.bigint().parse("1"))[0]?.expected).toBe("bigint");
	});

	test("bigint min and max validate bounds", () => {
		const schema = Schema.bigint().min(1n).max(3n);

		expect(valid(schema.parse(1n))).toBe(1n);
		expect(valid(schema.parse(3n))).toBe(3n);
		expect(invalid(schema.parse(0n))[0]?.expected).toBe("refine");
		expect(invalid(schema.parse(4n))[0]?.expected).toBe("refine");
	});

	test("email validates format", () => {
		expect(valid(Schema.string().email().parse("person@example.com"))).toBe(
			"person@example.com",
		);
		expect(invalid(Schema.string().email().parse("bad"))[0]?.expected).toBe(
			"refine",
		);
	});

	test("url validates parsable URL", () => {
		expect(valid(Schema.string().url().parse("https://example.com"))).toBe(
			"https://example.com",
		);
		expect(invalid(Schema.string().url().parse("not a url"))[0]?.expected).toBe(
			"refine",
		);
	});

	test("literal enforces exact value", () => {
		expect(valid(Schema.literal("x").parse("x"))).toBe("x");
		expect(invalid(Schema.literal("x").parse("y"))[0]?.expected).toBe("x");
	});

	test("enum validates one of the allowed values", () => {
		const schema = Schema.enum(["a", "b"]);

		expect(valid(schema.parse("a"))).toBe("a");
		expect(invalid(schema.parse("c"))[0]?.expected).toBe('"a" | "b"');
	});

	test("instance validates constructor", () => {
		class Example {}
		const value = new Example();

		expect(valid(Schema.instance(Example).parse(value))).toBe(value);
		expect(invalid(Schema.instance(Example).parse({}))[0]?.expected).toBe(
			"Example",
		);
	});
});

describe("Schema combinators", () => {
	test("optional allows undefined", () => {
		expect(valid(Schema.string().optional().parse(undefined))).toBeUndefined();
	});

	test("nullable allows null", () => {
		expect(valid(Schema.string().nullable().parse(null))).toBeNull();
	});

	test("nullish allows both null and undefined", () => {
		const schema = Schema.string().nullish();

		expect(valid(schema.parse(null))).toBeNull();
		expect(valid(schema.parse(undefined))).toBeUndefined();
	});

	test("default applies only when input is undefined", () => {
		const schema = Schema.string().default("fallback");

		expect(valid(schema.parse(undefined))).toBe("fallback");
		expect(valid(schema.parse("set"))).toBe("set");
	});

	test("transform maps parsed output", () => {
		const schema = Schema.string().transform((value) => value.length);

		expect(valid(schema.parse("abc"))).toBe(3);
	});

	test("pipe validates transformed result", () => {
		const schema = Schema.string()
			.transform((value) => Number(value))
			.pipe(Schema.number());

		expect(valid(schema.parse("42"))).toBe(42);
		expect(invalid(schema.parse("bad"))[0]?.expected).toBe("number");
	});

	test("refine adds custom validation", () => {
		const schema = Schema.string().refine(
			(value) => value.length > 2,
			"too short",
		);
		const issues = invalid(schema.parse("no"));

		expect(issues[0]?.expected).toBe("refine");
		expect(issues[0]?.message).toBe("too short");
	});

	test("union returns first valid schema", () => {
		const schema = Schema.union([Schema.string(), Schema.number()]);

		expect(valid(schema.parse("hello"))).toBe("hello");
		expect(valid(schema.parse(1))).toBe(1);
		expect(invalid(schema.parse(true))).toHaveLength(2);
	});
});

describe("JSON schema", () => {
	test("parses valid JSON and validates inner schema", () => {
		const schema = Schema.string().json(
			Schema.object({ id: Schema.string(), expiration: Schema.number() }),
		);

		expect(valid(schema.parse('{"id":"123","expiration":1}'))).toEqual({
			id: "123",
			expiration: 1,
		});
	});

	test("fails on invalid JSON strings", () => {
		expect(
			invalid(Schema.string().json(Schema.unknown()).parse("{"))[0]?.expected,
		).toBe("JSON");
	});

	test("fails on non-string input", () => {
		expect(
			invalid(Schema.string().json(Schema.unknown()).parse(1))[0]?.expected,
		).toBe("string");
	});

	test("does not swallow inner schema exceptions as JSON issues", () => {
		const schema = Schema.string().json(
			Schema.number().transform(() => {
				throw new Error("boom");
			}),
		);

		expect(() => schema.parse("1")).toThrowError("boom");
	});

	test("uses custom message for JSON parse failures", () => {
		const schema = Schema.string().json(Schema.unknown(), "Bad JSON");
		const issues = invalid(schema.parse("{"));

		expect(issues[0]?.message).toBe("Bad JSON");
	});
});

describe("Array and object schemas", () => {
	test("array validates each item and reports numeric path indexes", () => {
		const issues = invalid(Schema.array(Schema.number()).parse([1, "x", 3]));

		expect(issues[0]?.path).toEqual([1]);
		expect(issues[0]?.expected).toBe("number");
	});

	test("object without shape defaults to empty strip object", () => {
		expect(valid(Schema.object().parse({ a: 1 }))).toEqual({});
		expect(invalid(Schema.object().parse([1]))[0]?.expected).toBe("Object");
	});

	test("object strict rejects unknown keys", () => {
		const schema = Schema.object({ a: Schema.string() }).strict();
		const issues = invalid(schema.parse({ a: "x", b: 1 }));

		expect(issues[0]?.path).toEqual(["b"]);
		expect(issues[0]?.expected).toBe("never");
	});

	test("object loose preserves unknown keys", () => {
		const schema = Schema.object({ a: Schema.string() }).loose();
		const data = valid(schema.parse({ a: "x", b: 1 })) satisfies {
			a: string;
		} & Record<string, unknown>;

		expect(data).toEqual({ a: "x", b: 1 });
	});

	test("object without shape supports strict and loose modes", () => {
		expect(valid(Schema.object().loose().parse({ a: 1 }))).toEqual({ a: 1 });

		const strict = Schema.object().strict();
		const issues = invalid(strict.parse({ a: 1 }));

		expect(issues[0]?.path).toEqual(["a"]);
		expect(issues[0]?.expected).toBe("never");
	});

	test("loose objects preserve __proto__ as data without changing the prototype", () => {
		const input = JSON.parse('{"name":"guest","__proto__":{"admin":true}}');
		const data = valid(
			Schema.object({ name: Schema.string() }).loose().parse(input),
		);

		expect(data.admin).toBeUndefined();
		expect(Object.hasOwn(data, "__proto__")).toBe(true);
		expect([Object.prototype, null]).toContain(Object.getPrototypeOf(data));
		expect(JSON.stringify(data)).toBe(JSON.stringify(input));
	});

	test("a valid large array can match the second branch of a union", () => {
		const schema = Schema.union([
			Schema.array(Schema.string()),
			Schema.array(Schema.number()),
		]);
		const input = Array<number>(150_000).fill(1);
		expect(valid(schema.parse(input))).toHaveLength(input.length);
	});

	test("a declared form field called __proto__ cannot supply inherited privileges", async () => {
		const form = new Form({
			["__proto__"]: Field.hidden().json(
				Schema.object({ admin: Schema.boolean() }),
			),
		});
		const result = formValid(
			await form.parse(new URLSearchParams([["__proto__", '{"admin":true}']])),
		);
		expect(Reflect.get(result.data, "admin")).toBeUndefined();
		expect(Object.hasOwn(result.data, "__proto__")).toBe(true);
	});

	test("declared __proto__ properties remain own properties after validation", () => {
		const input = JSON.parse('{"__proto__":{"admin":true}}');
		const data = valid(
			Schema.object({
				["__proto__"]: Schema.object({ admin: Schema.boolean() }),
			}).parse(input),
		);

		expect(Object.hasOwn(data, "__proto__")).toBe(true);
		expect([Object.prototype, null]).toContain(Object.getPrototypeOf(data));
		expect(JSON.stringify(data)).toBe(JSON.stringify(input));
	});

	test("object shape parses fields and supports defaults", () => {
		const schema = Schema.object({
			a: Schema.string(),
			b: Schema.number().optional(),
			c: Schema.string().default("x"),
		});
		const result = valid(schema.parse({ a: "hello" }));

		expect(result).toEqual({ a: "hello", c: "x" });
	});

	test("object inference marks undefined outputs optional", () => {
		const schema = Schema.object({
			a: Schema.string(),
			b: Schema.number().optional(),
			c: Schema.boolean().nullish(),
		});
		const result = valid(schema.parse({ a: "hello" })) satisfies {
			a: string;
			b?: number;
			c?: boolean | null;
		};
		type Got = Schema.Infer<typeof schema>;
		type Want = { a: string; b?: number; c?: boolean | null };
		type Check = Assert<Same<Got, Want>>;
		const check: Check = true;

		expect(check).toBe(true);
		expect(result).toEqual({ a: "hello" });
	});

	test("object keeps defined nullish values", () => {
		const schema = Schema.object({
			a: Schema.string(),
			b: Schema.boolean().nullish(),
		});

		expect(valid(schema.parse({ a: "hello", b: null }))).toEqual({
			a: "hello",
			b: null,
		});
	});

	test("object shape methods pick and omit work", () => {
		const base = Schema.object({
			a: Schema.string(),
			b: Schema.number(),
			c: Schema.boolean(),
		});
		const picked = base.pick(["a", "c"]);
		const omitted = base.omit(["b"]);

		expect(valid(picked.parse({ a: "x", b: 1, c: true }))).toEqual({
			a: "x",
			c: true,
		});
		expect(valid(omitted.parse({ a: "x", b: 1, c: true }))).toEqual({
			a: "x",
			c: true,
		});
	});

	test("object extend merges additional schema fields", () => {
		const schema = Schema.object({ a: Schema.string() }).extend({
			b: Schema.number(),
		});

		expect(valid(schema.parse({ a: "x", b: 2 }))).toEqual({ a: "x", b: 2 });
	});

	test("object extend accepts another object schema", () => {
		const base = Schema.object({ a: Schema.string() });
		const extra = Schema.object({ b: Schema.number() });
		const schema = base.extend(extra);
		const result = valid(schema.parse({ a: "x", b: 2 })) satisfies {
			a: string;
			b: number;
		};

		expect(result).toEqual({ a: "x", b: 2 });
	});

	test("object mode is preserved through extend", () => {
		const schema = Schema.object({ a: Schema.string() })
			.strict()
			.extend({ b: Schema.number() });
		const issues = invalid(schema.parse({ a: "x", b: 1, c: true }));

		expect(issues[0]?.path).toEqual(["c"]);
		expect(issues[0]?.expected).toBe("never");
	});
});

describe("Preprocess schemas", () => {
	test("string preprocess converts with String", () => {
		expect(valid(Schema.string().preprocess(String).parse(10))).toBe("10");
	});

	test("number preprocess supports int chain", () => {
		expect(valid(Schema.number().preprocess(Number).int().parse("10"))).toBe(
			10,
		);
		expect(
			invalid(Schema.number().preprocess(Number).int().parse("10.5"))[0]
				?.expected,
		).toBe("refine");
	});

	test("number preprocess rejects NaN", () => {
		expect(
			invalid(Schema.number().preprocess(Number).parse("abc"))[0]?.expected,
		).toBe("number");
	});

	test("boolean preprocess converts with Boolean", () => {
		expect(valid(Schema.boolean().preprocess(Boolean).parse(""))).toBe(false);
		expect(valid(Schema.boolean().preprocess(Boolean).parse("yes"))).toBe(true);
	});

	test("bigint preprocess parses coercible values", () => {
		const schema = Schema.bigint().preprocess((v) => BigInt(v as any));

		expect(valid(schema.parse("10"))).toBe(10n);
	});

	test("bigint preprocess propagates thrown errors", () => {
		const schema = Schema.bigint().preprocess((v) => BigInt(v as any));

		expect(() => schema.parse({})).toThrowError();
	});

	test("field string chains preserve Field behavior", () => {
		const field = Field.text().email();

		expect(valid(field.parse("person@example.com"))).toBe("person@example.com");
		expect("component" in field).toBe(true);
	});

	test("field min and max chains preserve Field behavior", () => {
		const field = Field.text().min(2).max(4);

		expect(valid(field.parse("ab"))).toBe("ab");
		expect(invalid(field.parse("a"))[0]?.expected).toBe("refine");
		expect("component" in field).toBe(true);
	});

	test("field number treats blank input as missing", () => {
		const field = Field.number();

		expect(valid(field.parse("0"))).toBe(0);
		expect(invalid(field.parse(""))[0]?.message).toBe("Required field");
	});

	test("numeric fields reject unsafe integers already converted to numbers", () => {
		for (const value of [
			Number.MAX_SAFE_INTEGER + 1,
			-Number.MAX_SAFE_INTEGER - 1,
		]) {
			expect(Field.number().parse(value).issues).toBeDefined();
		}
	});

	test("field number rejects non-finite coerced values", () => {
		expect(invalid(Field.number().parse("1e309"))[0]?.expected).toBe("number");
	});

	test("field text still parses blank strings directly", () => {
		expect(valid(Field.text().default("fallback").parse(""))).toBe("");
		expect(valid(Field.textarea().default("fallback").parse(""))).toBe("");
	});

	test("field text no longer coerces non-string values", () => {
		expect(invalid(Field.text().parse(1))[0]?.expected).toBe("string");
		expect(invalid(Field.textarea().parse(true))[0]?.expected).toBe("string");
	});
});

describe("toJsonSchema", () => {
	const draft = "https://json-schema.org/draft/2020-12/schema";

	test("a field's label is its title", () => {
		const form = Schema.object({
			dob: Field.date().label("Date of birth"),
			tz: Field.text().label("Time zone").optional(),
			agree: Field.checkbox().label("I agree"),
			name: Field.text(),
		});
		const { properties } = form.toJsonSchema({ io: "input" });
		expect(properties).toMatchObject({
			dob: { title: "Date of birth" },
			tz: { title: "Time zone", type: "string" },
			agree: { title: "I agree", type: "boolean", default: false },
		});
		expect(properties).not.toHaveProperty("name.title");
	});

	test("an unchecked box may be left out of input, and is always output", () => {
		const form = Schema.object({
			agree: Field.checkbox(),
			topics: Field.checkboxes(["a", "b"]),
		});
		const input = form.toJsonSchema({ io: "input" });
		expect(input.properties).toMatchObject({
			agree: { type: "boolean", default: false },
		});
		expect(input.required).toEqual(["topics"]);
		expect(form.toJsonSchema({ io: "output" }).required).toEqual([
			"agree",
			"topics",
		]);
	});

	test("primitives", () => {
		expect(Schema.string().toJsonSchema()).toEqual({
			$schema: draft,
			type: "string",
		});
		expect(Schema.number().int().min(1).max(10).toJsonSchema()).toEqual({
			$schema: draft,
			type: "integer",
			minimum: 1,
			maximum: 10,
		});
		expect(Schema.string().min(2).max(5).email().toJsonSchema()).toEqual({
			$schema: draft,
			type: "string",
			minLength: 2,
			maxLength: 5,
			format: "email",
		});
		expect(Schema.string().url().toJsonSchema().format).toBe("uri");
		expect(Schema.boolean().toJsonSchema().type).toBe("boolean");
		expect(Schema.unknown().toJsonSchema()).toEqual({ $schema: draft });
	});

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

	test("fractional string bounds become valid integer length keywords", () => {
		const schema = Schema.string().min(1.5).max(3.5);

		expect(schema.parse("ab").data).toBe("ab");
		expect(schema.toJsonSchema()).toMatchObject({ minLength: 2, maxLength: 3 });
	});

	test("refine keeps the base description", () => {
		expect(
			Schema.string()
				.refine((s) => s.startsWith("a"), "a")
				.toJsonSchema(),
		).toEqual({ $schema: draft, type: "string" });
	});

	test("literal, enum, union, nullable", () => {
		expect(Schema.literal("a").toJsonSchema().const).toBe("a");
		expect(Schema.enum(["a", 1, null]).toJsonSchema().enum).toEqual([
			"a",
			1,
			null,
		]);
		expect(
			Schema.union([Schema.string(), Schema.number()]).toJsonSchema().anyOf,
		).toEqual([{ type: "string" }, { type: "number" }]);
		expect(Schema.string().nullable().toJsonSchema().anyOf).toEqual([
			{ type: "string" },
			{ type: "null" },
		]);
	});

	test("objects and arrays", () => {
		const schema = Schema.object({
			name: Schema.string(),
			tags: Schema.array(Schema.string()),
			age: Schema.number().optional(),
			role: Schema.enum(["admin", "user"]).default("user"),
			note: Schema.string().nullish(),
		});

		expect(schema.toJsonSchema()).toEqual({
			$schema: draft,
			type: "object",
			properties: {
				name: { type: "string" },
				tags: { type: "array", items: { type: "string" } },
				age: { type: "number" },
				role: { enum: ["admin", "user"] },
				note: { anyOf: [{ type: "string" }, { type: "null" }] },
			},
			required: ["name", "tags", "role"],
			additionalProperties: false,
		});

		const input = schema.toJsonSchema({ io: "input" });
		expect(input.required).toEqual(["name", "tags"]);
		expect(input.additionalProperties).toBeUndefined();
		expect((input.properties as any).role.default).toBe("user");
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

	test("object modes", () => {
		const shape = { a: Schema.string() };
		expect(
			Schema.object(shape).strict().toJsonSchema({ io: "input" })
				.additionalProperties,
		).toBe(false);
		expect(
			Schema.object(shape).loose().toJsonSchema().additionalProperties,
		).toBeUndefined();
		expect(Schema.object().toJsonSchema().required).toBeUndefined();
	});

	test("checks after a transform do not constrain the untransformed input", () => {
		const schema = Schema.string()
			.transform((s) => s.repeat(2))
			.min(3);

		expect(schema.parse("ab").data).toBe("abab");
		expect(schema.toJsonSchema({ io: "input" }).minLength).toBeUndefined();
	});

	test("io differences for preprocess, pipe, json", () => {
		const n = Schema.number().preprocess(Number);
		expect(n.toJsonSchema({ io: "input" })).toEqual({ $schema: draft });
		expect(n.toJsonSchema().type).toBe("number");

		const piped = Schema.string().pipe(Schema.string().email());
		expect(piped.toJsonSchema({ io: "input" }).format).toBeUndefined();
		expect(piped.toJsonSchema().format).toBe("email");

		const json = Schema.string().json(Schema.object({ a: Schema.number() }));
		expect(json.toJsonSchema().type).toBe("object");
		expect(json.toJsonSchema({ io: "input" })).toEqual({
			$schema: draft,
			type: "string",
			contentMediaType: "application/json",
			contentSchema: {
				type: "object",
				properties: { a: { type: "number" } },
				required: ["a"],
			},
		});
		expect(
			json.toJsonSchema({ io: "input", target: "draft-07" }).contentSchema,
		).toBeUndefined();
	});

	test("unrepresentable", () => {
		expect(() => Schema.bigint().toJsonSchema()).toThrow(TypeError);
		expect(() => Schema.instance(Date).toJsonSchema()).toThrow(TypeError);
		expect(() => Schema.literal(1n).toJsonSchema()).toThrow(TypeError);
		const t = Schema.string().transform((s) => s.length);
		expect(() => t.toJsonSchema()).toThrow(TypeError);
		expect(t.toJsonSchema({ io: "input" }).type).toBe("string");
		expect(t.toJsonSchema({ unrepresentable: "any" })).toEqual({
			$schema: draft,
		});
		expect(
			Schema.object({ d: Schema.instance(Date) }).toJsonSchema({
				unrepresentable: "any",
			}).properties,
		).toEqual({ d: {} });
	});

	test("targets", () => {
		expect(Schema.string().toJsonSchema({ target: "draft-07" }).$schema).toBe(
			"http://json-schema.org/draft-07/schema#",
		);
		expect(() =>
			Schema.string().toJsonSchema({ target: "openapi-3.0" as any }),
		).toThrow(TypeError);
	});

	test("fields keep descriptions through chaining", () => {
		const schema = Schema.object({
			email: Field.email(),
			count: Field.number().int().min(0).optional(),
			plan: Field.select(["free", "pro"]).persist(),
			bio: Field.textarea().max(500).stream(),
			agree: Field.checkbox(),
		});

		expect(schema.toJsonSchema()).toEqual({
			$schema: draft,
			type: "object",
			properties: {
				email: { type: "string", format: "email" },
				count: { type: "integer", minimum: 0 },
				plan: { enum: ["free", "pro"] },
				bio: { type: "string", maxLength: 500 },
				agree: { type: "boolean" },
			},
			required: ["email", "plan", "bio", "agree"],
			additionalProperties: false,
		});
		expect(() => Field.file().toJsonSchema()).toThrow(TypeError);
	});

	test("~standard jsonSchema", () => {
		const schema = Schema.string().transform(Number);
		const standard = schema["~standard"].jsonSchema;
		expect(standard.input({ target: "draft-07" })).toEqual({
			$schema: "http://json-schema.org/draft-07/schema#",
			type: "string",
		});
		expect(
			standard.output({
				target: "draft-2020-12",
				libraryOptions: { unrepresentable: "any" },
			}),
		).toEqual({ $schema: draft });
		expect(() => standard.input({ target: "openapi-3.0" })).toThrow(TypeError);
	});
});

describe("Schema.date", () => {
	test("accepts valid dates", () => {
		const date = new Date();
		expect(valid(Schema.date().parse(date))).toBe(date);
	});

	test("rejects invalid dates and other values", () => {
		expect(invalid(Schema.date().parse(new Date("")))[0].expected).toBe("Date");
		expect(invalid(Schema.date().parse("2026-01-01")).length).toBe(1);
		expect(invalid(Schema.date("Pick a date").parse(1))[0].message).toBe(
			"Pick a date",
		);
	});

	test("cannot be represented in JSON Schema", () => {
		expect(() => Schema.date().toJsonSchema()).toThrow(TypeError);
	});
});

describe("uuid", () => {
	test("validates UUIDs of any version", () => {
		const schema = Schema.string().uuid();
		expect(valid(schema.parse(crypto.randomUUID()))).toBeTypeOf("string");
		expect(valid(schema.parse("00000000-0000-0000-0000-000000000000"))).toBe(
			"00000000-0000-0000-0000-000000000000",
		);
		expect(invalid(schema.parse("not-a-uuid"))[0].message).toBe(
			"Expected UUID",
		);
	});

	test("describes format uuid", () => {
		expect(Schema.string().uuid().toJsonSchema().format).toBe("uuid");
		expect(Field.hidden().uuid().toJsonSchema().format).toBe("uuid");
	});
});

describe("def", () => {
	test("exposes the inspectable definition", () => {
		const inner = Schema.number();
		const schema = inner.int().nullable();

		if (schema.def.type !== "nullable") throw new Error("Expected nullable");
		expect(schema.def.inner.def).toMatchObject({
			type: "check",
			inner,
			check: { name: "int" },
		});
	});

	test("chaining never mutates the source schema", () => {
		const base = Schema.string();
		base.min(2).email();
		expect(base.def).toEqual({ type: "string", message: undefined });
	});

	test("fields keep their definition through stream and persist", () => {
		const field = Field.text().min(2);
		expect(field.stream().def).toBe(field.def);
		expect(field.persist().def).toBe(field.def);
	});
});

describe("string length", () => {
	test("counts Unicode characters like JSON Schema", () => {
		expect(Schema.string().min(2).parse("😀").issues).toBeDefined();
		expect(Schema.string().max(1).parse("😀").data).toBe("😀");
		expect(Schema.string().min(2).max(2).parse("a😀").data).toBe("a😀");
		// a lone surrogate is one character
		expect(Schema.string().max(1).parse("\ud83d").data).toBe("\ud83d");
		expect(Schema.string().max(1).parse("😀😀").issues).toBeDefined();
		expect(Schema.string().min(3).parse("😀😀").issues).toBeDefined();
		expect(Schema.string().min(1).parse("x".repeat(10)).data).toHaveLength(10);
	});
});

describe("issue paths", () => {
	test("each issue has its own full path, and the caller's path is unchanged", () => {
		const schema = Schema.object({
			a: Schema.array(Schema.object({ b: Schema.string() })),
			c: Schema.union([Schema.number(), Schema.boolean()]),
		});
		const path = ["root"];
		const result = schema.parse(
			{ a: [{ b: "ok" }, { b: 1 }, {}], c: "x" },
			path,
		);

		expect(path).toEqual(["root"]);
		expect(result.issues?.map((issue) => issue.path)).toEqual([
			["root", "a", 1, "b"],
			["root", "a", 2, "b"],
			["root", "c"],
			["root", "c"],
		]);
		expect(result.issues?.[0]?.path).not.toBe(result.issues?.[1]?.path);
		expect(result.issues).toBeInstanceOf(Array);
		expect(result).toBeInstanceOf(Schema.AggregateIssue);
		// a valid parse after a failure starts from a clean path
		expect(schema.parse({ a: [], c: 1 })).toEqual({ data: { a: [], c: 1 } });
	});
});
