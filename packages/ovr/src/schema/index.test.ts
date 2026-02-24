import { Render } from "../render/index.js";
import { Codec } from "../util/index.js";
import { Schema } from "./index.js";
import { describe, expect, test } from "vitest";

const valid = <T>(result: Schema.Parse.Result<T>) => {
	if (result.issues) throw new Error("Expected no issues");
	return result.data;
};

const invalid = <T>(result: Schema.Parse.Result<T>) => {
	if (!result.issues) throw new Error("Expected issues");
	return result.issues;
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

	test("number validates finite number and rejects NaN", () => {
		expect(valid(Schema.number().parse(1))).toBe(1);
		expect(invalid(Schema.number().parse(NaN))[0]?.expected).toBe("number");
	});

	test("int validates safe integers", () => {
		expect(valid(Schema.number().int().parse(10))).toBe(10);
		expect(invalid(Schema.number().int().parse(10.5))[0]?.expected).toBe(
			"refine",
		);
	});

	test("bigint validates type", () => {
		expect(valid(Schema.bigint().parse(1n))).toBe(1n);
		expect(invalid(Schema.bigint().parse("1"))[0]?.expected).toBe("bigint");
	});

	test("date validates valid Date instances", () => {
		const date = new Date("2024-01-01T00:00:00.000Z");
		expect(valid(Schema.date().parse(date))).toBe(date);
		expect(
			invalid(Schema.date().parse(new Date("not-a-date")))[0]?.expected,
		).toBe("refine");
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

	test("supports untyped parsing with Schema.unknown", () => {
		expect(
			valid(Schema.string().json(Schema.unknown()).parse('{"hello":"world"}')),
		).toEqual({ hello: "world" });
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

	test("object shape parses fields and supports defaults", () => {
		const schema = Schema.object({
			a: Schema.string(),
			b: Schema.number().optional(),
			c: Schema.string().default("x"),
		});
		const result = valid(schema.parse({ a: "hello" }));

		expect(result.a).toBe("hello");
		expect(result.b).toBeUndefined();
		expect(result.c).toBe("x");
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

	test("object mode is preserved through extend", () => {
		const schema = Schema.object({ a: Schema.string() })
			.strict()
			.extend({ b: Schema.number() });
		const issues = invalid(schema.parse({ a: "x", b: 1, c: true }));

		expect(issues[0]?.path).toEqual(["c"]);
		expect(issues[0]?.expected).toBe("never");
	});
});

describe("Coercion schemas", () => {
	test("coerce.string uses String", () => {
		expect(valid(Schema.Coerce.string().parse(10))).toBe("10");
	});

	test("coerce.string supports email/url/json chains", () => {
		expect(valid(Schema.Coerce.string().email().parse("person@example.com"))).toBe(
			"person@example.com",
		);
		expect(invalid(Schema.Coerce.string().email().parse({}))[0]?.expected).toBe(
			"refine",
		);

		expect(valid(Schema.Coerce.string().url().parse("https://example.com"))).toBe(
			"https://example.com",
		);
		expect(
			invalid(Schema.Coerce.string().url().parse("not a url"))[0]?.expected,
		).toBe("refine");

		expect(
			valid(
				Schema.Coerce.string()
					.json(Schema.unknown())
					.parse('{"hello":"world"}'),
			),
		).toEqual({ hello: "world" });
		expect(
			invalid(Schema.Coerce.string().json(Schema.unknown()).parse({}))[0]
				?.expected,
		).toBe("JSON");
	});

	test("coerce.number uses Number", () => {
		expect(valid(Schema.Coerce.number().parse("10"))).toBe(10);
	});

	test("coerce.number supports int chain", () => {
		expect(valid(Schema.Coerce.number().int().parse("10"))).toBe(10);
		expect(invalid(Schema.Coerce.number().int().parse("10.5"))[0]?.expected).toBe(
			"refine",
		);
	});

	test("coerce.boolean uses Boolean", () => {
		expect(valid(Schema.Coerce.boolean().parse(""))).toBe(false);
		expect(valid(Schema.Coerce.boolean().parse("yes"))).toBe(true);
	});

	test("coerce.bigint validates coercible values", () => {
		expect(valid(Schema.Coerce.bigint().parse("10"))).toBe(10n);
		expect(invalid(Schema.Coerce.bigint().parse({}))[0]?.expected).toBe(
			"string | number | bigint | boolean",
		);
	});

	test("coerce.date validates resulting Date", () => {
		const result = valid(Schema.Coerce.date().parse("2024-01-01"));
		expect(result).toBeInstanceOf(Date);
		expect(Number.isNaN(result.getTime())).toBe(false);

		expect(invalid(Schema.Coerce.date().parse("not-a-date"))[0]?.expected).toBe(
			"refine",
		);
	});

	test("field string chains preserve Field behavior", () => {
		const field = Schema.Field.text().email();

		expect(valid(field.parse("person@example.com"))).toBe("person@example.com");
		expect("Component" in field).toBe(true);
	});
});

describe("Form schema", () => {
	test("parses mixed field types and leaves date strings unvalidated", () => {
		const form = Schema.form({
			name: Schema.Field.text(),
			age: Schema.Field.number(),
			active: Schema.Field.checkbox(),
			date: Schema.Field.date(),
			roles: Schema.Field.checkboxes(["reader", "admin"]),
			level: Schema.Field.radio(["junior", "senior"]),
			tags: Schema.Field.multiselect(["a", "b", "c"]),
			bio: Schema.Field.textarea(),
		});
		const data = new FormData();

		data.set("name", "ross");
		data.set("age", "31");
		data.set("active", "on");
		data.set("date", "not-a-date");
		data.append("roles", "reader");
		data.append("roles", "admin");
		data.set("level", "senior");
		data.append("tags", "a");
		data.append("tags", "c");
		data.set("bio", "hello");

		expect(valid(form.parse(data))).toEqual({
			name: "ross",
			age: 31,
			active: true,
			date: "not-a-date",
			roles: ["reader", "admin"],
			level: "senior",
			tags: ["a", "c"],
			bio: "hello",
		});
	});

	test("parses mixed field types from URLSearchParams", () => {
		const form = Schema.form({
			name: Schema.Field.text(),
			age: Schema.Field.number(),
			active: Schema.Field.checkbox(),
			roles: Schema.Field.checkboxes(["reader", "admin"]),
			level: Schema.Field.radio(["junior", "senior"]),
			tags: Schema.Field.multiselect(["a", "b", "c"]),
		});
		const params = new URLSearchParams();

		params.set("name", "ross");
		params.set("age", "31");
		params.set("active", "on");
		params.append("roles", "reader");
		params.append("roles", "admin");
		params.set("level", "senior");
		params.append("tags", "a");
		params.append("tags", "c");

		expect(valid(form.parse(params))).toEqual({
			name: "ross",
			age: 31,
			active: true,
			roles: ["reader", "admin"],
			level: "senior",
			tags: ["a", "c"],
		});
	});

	test("checkbox is false when omitted", () => {
		const form = Schema.form({ active: Schema.Field.checkbox() });
		expect(valid(form.parse(new FormData()))).toEqual({ active: false });
	});

	test("checkbox is false when omitted in URLSearchParams", () => {
		const form = Schema.form({ active: Schema.Field.checkbox() });
		expect(valid(form.parse(new URLSearchParams()))).toEqual({ active: false });
	});

	test("invalid parse includes encoded _form state without password/file values", () => {
		const form = Schema.form({
			name: Schema.Field.text(),
			role: Schema.Field.radio(["reader", "admin"]),
			password: Schema.Field.password(),
			avatar: Schema.Field.file(),
		});
		const data = new FormData();
		const file = new File(["x"], "a.txt", { type: "text/plain" });

		data.set("name", "ross");
		data.set("role", "owner");
		data.set("password", "secret");
		data.append("avatar", file);

		const result = form.parse(data);
		if (!result.issues) throw new Error("Expected issues");
		if (!result.search) throw new Error("Expected _form search state");

		expect(result.search[0]).toBe("_form");

		const state = JSON.parse(
			Codec.decode(Codec.Base64Url.decode(result.search[1])),
		) as Schema.Form.State;

		expect(state.values?.name).toBe("ross");
		expect(state.values?.role).toBe("owner");
		expect(state.values?.password).toBeUndefined();
		expect(state.values?.avatar).toBeUndefined();
		expect(state.id).toBeTruthy();
		expect(state.issues?.length).toBeGreaterThan(0);
	});

	test("invalid URLSearchParams parse includes encoded _form state", () => {
		const form = Schema.form({
			name: Schema.Field.text(),
			role: Schema.Field.radio(["reader", "admin"]),
			password: Schema.Field.password(),
		});
		const params = new URLSearchParams();

		params.set("name", "ross");
		params.set("role", "owner");
		params.set("password", "secret");

		const result = form.parse(params);
		if (!result.issues) throw new Error("Expected issues");
		if (!result.search) throw new Error("Expected _form search state");

		expect(result.search[0]).toBe("_form");

		const state = JSON.parse(
			Codec.decode(Codec.Base64Url.decode(result.search[1])),
		) as Schema.Form.State;

		expect(state.values?.name).toBe("ross");
		expect(state.values?.role).toBe("owner");
		expect(state.values?.password).toBeUndefined();
		expect(state.id).toBeTruthy();
		expect(state.issues?.length).toBeGreaterThan(0);
	});

	test("invalid URL _form state is ignored when rendering fields", async () => {
		const form = Schema.form({
			name: Schema.Field.text(),
			role: Schema.Field.radio(["reader", "admin"]),
		});
		const data = new FormData();

		data.set("name", "ross");
		data.set("role", "owner");

		const result = form.parse(data);
		if (!result.issues) throw new Error("Expected issues");
		if (!result.search) throw new Error("Expected _form search state");

		const state = JSON.parse(
			Codec.decode(Codec.Base64Url.decode(result.search[1])),
		) as Schema.Form.State;
		const tampered = {
			...state,
			issues: undefined,
			values: { name: { bad: true } },
		};

		const url = new URL("https://example.com/form");

		url.searchParams.set(
			"_form",
			Codec.Base64Url.encode(Codec.encode(JSON.stringify(tampered))),
		);

		const html = await new Render(null).string(
			form.Field({ name: "name", state: url }),
		);

		expect(html.includes('name="name"')).toBe(true);
		expect(html.includes('value="{')).toBe(false);
		expect(html.includes("aria-invalid")).toBe(false);
	});

	test("form shape methods extend, pick, and omit preserve parse behavior", () => {
		const extended = Schema.form({ a: Schema.Field.text() }).extend({
			b: Schema.Field.checkbox(),
		});
		const picked = Schema.form({
			a: Schema.Field.text(),
			b: Schema.Field.number(),
			c: Schema.Field.checkbox(),
		}).pick(["a", "c"]);
		const omitted = Schema.form({
			a: Schema.Field.text(),
			b: Schema.Field.number(),
			c: Schema.Field.checkbox(),
		}).omit(["b"]);

		const data = new FormData();
		data.set("a", "x");
		data.set("b", "1");
		data.set("c", "on");

		expect(valid(extended.parse(data))).toEqual({ a: "x", b: true });
		expect(valid(picked.parse(data))).toEqual({ a: "x", c: true });
		expect(valid(omitted.parse(data))).toEqual({ a: "x", c: true });
	});

	test("form field helper APIs stay available after pick", () => {
		const form = Schema.form({
			a: Schema.Field.text(),
			b: Schema.Field.number(),
		}).pick(["a"]);

		expect(typeof form.Field).toBe("function");
		expect(typeof form.field({ name: "a" }).Control).toBe("function");
	});

	test("file and files fields parse file values", () => {
		const single = Schema.form({ upload: Schema.Field.file() });
		const many = Schema.form({ uploads: Schema.Field.files() });
		const one = new File(["one"], "one.txt", { type: "text/plain" });
		const two = new File(["two"], "two.txt", { type: "text/plain" });
		const oneData = new FormData();
		const manyData = new FormData();

		oneData.append("upload", one);
		manyData.append("uploads", one);
		manyData.append("uploads", two);

		expect(valid(single.parse(oneData)).upload.name).toBe("one.txt");
		expect(
			valid(many.parse(manyData)).uploads.map((file) => file.name),
		).toEqual(["one.txt", "two.txt"]);
	});
});
