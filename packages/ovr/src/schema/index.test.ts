import { Multipart } from "../multipart/index.js";
import { Render } from "../render/index.js";
import { Codec } from "../util/index.js";
import { Schema } from "./index.js";
import { describe, expect, test } from "vitest";

const valid = <T>(result: Schema.Parse.Result<T>): T => {
	if ("issues" in result) throw new Error("Expected no issues");
	return result.data;
};

const invalid = <T>(result: Schema.Parse.Result<T>) => {
	if (!result.issues) throw new Error("Expected issues");
	return result.issues;
};

const formValid = <S extends Schema.Form.Shape>(
	result: Schema.Form.Parse.Result<S>,
) => {
	if (result.issues) throw new Error("Expected no issues");
	return result;
};

const formInvalid = <S extends Schema.Form.Shape>(
	result: Schema.Form.Parse.Result<S>,
) => {
	if (!result.issues) throw new Error("Expected issues");
	return result;
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
		const field = Schema.Field.text().email();

		expect(valid(field.parse("person@example.com"))).toBe("person@example.com");
		expect("Component" in field).toBe(true);
	});

	test("field min and max chains preserve Field behavior", () => {
		const field = Schema.Field.text().min(2).max(4);

		expect(valid(field.parse("ab"))).toBe("ab");
		expect(invalid(field.parse("a"))[0]?.expected).toBe("refine");
		expect("Component" in field).toBe(true);
	});
});

describe("Form schema", () => {
	test("parses mixed field types and leaves date strings unvalidated", async () => {
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

		expect(valid(await form.parse(data))).toEqual({
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

	test("parses mixed field types from URLSearchParams", async () => {
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

		expect(valid(await form.parse(params))).toEqual({
			name: "ross",
			age: 31,
			active: true,
			roles: ["reader", "admin"],
			level: "senior",
			tags: ["a", "c"],
		});
	});

	test("checkbox is false when omitted", async () => {
		const form = Schema.form({ active: Schema.Field.checkbox() });
		expect(valid(await form.parse(new FormData()))).toEqual({ active: false });
	});

	test("invalid parse includes encoded _form state without password/file values", async () => {
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

		const result = formInvalid(await form.parse(data));
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

	test("invalid URLSearchParams parse includes encoded _form state", async () => {
		const form = Schema.form({
			name: Schema.Field.text(),
			role: Schema.Field.radio(["reader", "admin"]),
			password: Schema.Field.password(),
		});
		const params = new URLSearchParams();

		params.set("name", "ross");
		params.set("role", "owner");
		params.set("password", "secret");

		const result = formInvalid(await form.parse(params));
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

		const result = formInvalid(await form.parse(data));
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

	test("form shape methods extend, pick, and omit preserve parse behavior", async () => {
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

		const extendedData = new FormData();
		extendedData.set("a", "x");
		extendedData.set("b", "on");

		const pickedData = new FormData();
		pickedData.set("a", "x");
		pickedData.set("c", "on");

		const omittedData = new FormData();
		omittedData.set("a", "x");
		omittedData.set("c", "on");

		expect(valid(await extended.parse(extendedData))).toEqual({ a: "x", b: true });
		expect(valid(await picked.parse(pickedData))).toEqual({ a: "x", c: true });
		expect(valid(await omitted.parse(omittedData))).toEqual({ a: "x", c: true });
	});

	test("form field helper APIs stay available after pick", () => {
		const form = Schema.form({
			a: Schema.Field.text(),
			b: Schema.Field.number(),
		}).pick(["a"]);

		expect(typeof form.Field).toBe("function");
		expect(typeof form.field({ name: "a" }).Control).toBe("function");
	});

	test("file and files fields parse file values", async () => {
		const single = Schema.form({ upload: Schema.Field.file() });
		const many = Schema.form({ uploads: Schema.Field.files() });
		const one = new File(["one"], "one.txt", { type: "text/plain" });
		const two = new File(["two"], "two.txt", { type: "text/plain" });
		const oneData = new FormData();
		const manyData = new FormData();

		oneData.append("upload", one);
		manyData.append("uploads", one);
		manyData.append("uploads", two);

		const singleResult = formValid(await single.parse(oneData));
		const manyResult = formValid(await many.parse(manyData));

		expect(singleResult.data.upload.name).toBe("one.txt");
		expect(manyResult.data.uploads.map((file) => file.name)).toEqual([
			"one.txt",
			"two.txt",
		]);
	});

	test("multipart parse returns validated data and streamed parts together", async () => {
		const form = Schema.form({
			name: Schema.Field.text(),
			rules: Schema.Field.checkbox(),
			license: Schema.Field.file().part(),
		});
		const body = new FormData();

		body.set("name", "ross");
		body.set("rules", "on");
		body.set("license", new File(["abc"], "a.txt", { type: "text/plain" }));

		const multipart = new Multipart(
			new Request("http://localhost/upload", { method: "POST", body }),
		);
		const result = formValid(await form.parse(multipart));

		expect(result.data).toEqual({ name: "ross", rules: true });
		if (!result.parts) throw new Error("Expected streamed parts");

		for await (const part of result.parts) {
			expect(part.name).toBe("license");
			expect(part.filename).toBe("a.txt");
			expect((await part.bytes()).length).toBe(3);
			break;
		}
	});

	test("multipart parse does not expose parts when non-part fields are invalid", async () => {
		const form = Schema.form({
			name: Schema.Field.text().min(2),
			license: Schema.Field.file().part(),
		});
		const body = new FormData();

		body.set("name", "x");
		body.set("license", new File(["abc"], "a.txt", { type: "text/plain" }));

		const multipart = new Multipart(
			new Request("http://localhost/upload", { method: "POST", body }),
		);
		const result = formInvalid(await form.parse(multipart));
		expect(result.parts).toBeUndefined();
	});

	test("multipart parse adds issues for unexpected field names", async () => {
		const form = Schema.form({ name: Schema.Field.text() });
		const body = new FormData();

		body.set("name", "ross");
		body.set("extra", "x");

		const multipart = new Multipart(
			new Request("http://localhost/upload", { method: "POST", body }),
		);
		const result = formInvalid(await form.parse(multipart));

		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]?.path[0]).toBe("extra");
	});

	test("FormData parse adds issues for unexpected field names", async () => {
		const form = Schema.form({ name: Schema.Field.text() });
		const data = new FormData();

		data.set("name", "ross");
		data.set("extra", "x");
		const result = formInvalid(await form.parse(data));

		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]?.path[0]).toBe("extra");
	});

	test("FormData parse aggregates all unexpected field names", async () => {
		const form = Schema.form({ name: Schema.Field.text() });
		const data = new FormData();

		data.set("name", "ross");
		data.set("extraA", "x");
		data.set("extraB", "y");
		const result = formInvalid(await form.parse(data));

		expect(result.issues).toHaveLength(2);
		expect(result.issues.map((issue) => issue.path[0])).toEqual(
			expect.arrayContaining(["extraA", "extraB"]),
		);
	});

	test("URLSearchParams parse ignores unexpected field names", async () => {
		const form = Schema.form({ name: Schema.Field.text() });
		const params = new URLSearchParams();

		params.set("name", "ross");
		params.set("extra", "x");

		const result = formValid(await form.parse(params));

		expect(result.data).toEqual({ name: "ross" });
	});
});
