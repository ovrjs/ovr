import { Multipart } from "../multipart/index.js";
import { Render } from "../render/index.js";
import { Codec } from "../util/index.js";
import { Field, Form, Schema } from "./index.js";
import { describe, expect, test } from "vitest";

type FormValid<S extends Form.Shape> = Extract<
	Form.Parse.Result<S>,
	{ data: Form.Parse.Data<S> }
>;

type FormInvalid<S extends Form.Shape> = Exclude<
	Form.Parse.Result<S>,
	FormValid<S>
>;

const valid = <T>(result: Schema.Parse.Result<T>): T => {
	if ("issues" in result) throw new Error("Expected no issues");
	return result.data;
};

const invalid = <T>(result: Schema.Parse.Result<T>) => {
	if (!result.issues) throw new Error("Expected issues");
	return result.issues;
};

const formValid = <S extends Form.Shape>(result: Form.Parse.Result<S>) => {
	if (result.issues) throw new Error("Expected no issues");
	return result as FormValid<S>;
};

const formInvalid = <S extends Form.Shape>(result: Form.Parse.Result<S>) => {
	if (!result.issues) throw new Error("Expected issues");
	return result as FormInvalid<S>;
};

const decodeState = <S extends Form.Shape>(
	search: Form.Parse.Result.Search,
) => {
	if (!search) throw new Error("Expected _form search state");

	return JSON.parse(
		Codec.decode(Codec.Base64Url.decode(search[1])),
	) as Form.State<S>;
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
		expect(invalid(Schema.number().parse(Infinity))[0]?.expected).toBe("number");
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
		expect(invalid(field.parse(""))[0]?.expected).toBe("number");
	});

	test("field number rejects non-finite coerced values", () => {
		expect(invalid(Field.number().parse("1e309"))[0]?.expected).toBe("number");
	});

	test("field text still parses blank strings directly", () => {
		expect(valid(Field.text().default("fallback").parse(""))).toBe("");
		expect(valid(Field.textarea().default("fallback").parse(""))).toBe("");
	});

});

describe("Form schema", () => {
	test("parses mixed field types and leaves date strings unvalidated", async () => {
		const form = Form.from({
			name: Field.text(),
			age: Field.number(),
			active: Field.checkbox(),
			date: Field.date(),
			roles: Field.checkboxes(["reader", "admin"]),
			level: Field.radio(["junior", "senior"]),
			tags: Field.multiselect(["a", "b", "c"]),
			bio: Field.textarea(),
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
		const form = Form.from({
			name: Field.text(),
			age: Field.number(),
			active: Field.checkbox(),
			roles: Field.checkboxes(["reader", "admin"]),
			level: Field.radio(["junior", "senior"]),
			tags: Field.multiselect(["a", "b", "c"]),
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
		const form = Form.from({ active: Field.checkbox() });
		expect(valid(await form.parse(new FormData()))).toEqual({ active: false });
	});

	test("blank number fields are treated as missing during form parsing", async () => {
		const form = Form.from({
			age: Field.number().optional(),
			count: Field.number().default(5),
		});
		const data = new FormData();

		data.set("age", "");
		data.set("count", "");

		expect(valid(await form.parse(data))).toEqual({ age: undefined, count: 5 });
	});

	test("missing multi-value fields are invalid by default", async () => {
		const form = Form.from({
			roles: Field.checkboxes(["reader", "admin"]),
			tags: Field.multiselect(["a", "b", "c"]),
			uploads: Field.files(),
		});
		const result = formInvalid(await form.parse(new FormData()));

		expect(result.issues.map((issue) => issue.path[0])).toEqual([
			"roles",
			"tags",
			"uploads",
		]);
		expect(result.issues.map((issue) => issue.expected)).toEqual([
			"Array",
			"Array",
			"Array",
		]);
		expect(result.issues.map((issue) => issue.message)).toEqual([
			"Required field",
			"Required field",
			"Required field",
		]);
	});

	test("missing multi-value fields respect optional and default", async () => {
		const form = Form.from({
			roles: Field.checkboxes(["reader", "admin"]).optional(),
			tags: Field.multiselect(["a", "b", "c"]).default(["a"]),
			uploads: Field.files().optional(),
		});

		expect(valid(await form.parse(new FormData()))).toEqual({
			roles: undefined,
			tags: ["a"],
			uploads: undefined,
		});
	});

	test("blank date-like fields are treated as missing during form parsing", async () => {
		const form = Form.from({
			date: Field.date().optional(),
			time: Field.time().default("09:00"),
			datetime: Field.datetime().default("2026-09-01T09:00"),
			month: Field.month().default("2026-09"),
			week: Field.week().default("2026-W36"),
		});
		const data = new FormData();

		data.set("date", "");
		data.set("time", "");
		data.set("datetime", "");
		data.set("month", "");
		data.set("week", "");

		expect(valid(await form.parse(data))).toEqual({
			date: undefined,
			time: "09:00",
			datetime: "2026-09-01T09:00",
			month: "2026-09",
			week: "2026-W36",
		});
	});

	test("blank date-like search params are treated as missing", async () => {
		const form = Form.from({
			date: Field.date().optional(),
			time: Field.time().default("09:00"),
		});
		const params = new URLSearchParams();

		params.set("date", "");
		params.set("time", "");

		expect(valid(await form.parse(params))).toEqual({
			date: undefined,
			time: "09:00",
		});
	});

	test("blank single-value text fields are treated as missing", async () => {
		const form = Form.from({
			text: Field.text().optional(),
			password: Field.password().optional(),
			search: Field.search().default("fallback"),
			tel: Field.tel().default("555-0100"),
			color: Field.color().default("#000000"),
			hidden: Field.hidden().default("token"),
			email: Field.email().optional(),
			url: Field.url().default("https://example.com"),
			bio: Field.textarea().optional(),
		});
		const data = new FormData();

		data.set("text", "");
		data.set("password", "");
		data.set("search", "");
		data.set("tel", "");
		data.set("color", "");
		data.set("hidden", "");
		data.set("email", "");
		data.set("url", "");
		data.set("bio", "");

		expect(valid(await form.parse(data))).toEqual({
			text: undefined,
			password: undefined,
			search: "fallback",
			tel: "555-0100",
			color: "#000000",
			hidden: "token",
			email: undefined,
			url: "https://example.com",
			bio: undefined,
		});
	});

	test("blank single-value text search params are treated as missing", async () => {
		const form = Form.from({
			text: Field.text().optional(),
			email: Field.email().optional(),
			url: Field.url().default("https://example.com"),
			bio: Field.textarea().optional(),
		});
		const params = new URLSearchParams();

		params.set("text", "");
		params.set("email", "");
		params.set("url", "");
		params.set("bio", "");

		expect(valid(await form.parse(params))).toEqual({
			text: undefined,
			email: undefined,
			url: "https://example.com",
			bio: undefined,
		});
	});

	test("default empty strings still resolve after blank submissions", async () => {
		const form = Form.from({
			text: Field.text().default(""),
			password: Field.password().default(""),
			bio: Field.textarea().default(""),
		});
		const data = new FormData();

		data.set("text", "");
		data.set("password", "");
		data.set("bio", "");

		expect(valid(await form.parse(data))).toEqual({
			text: "",
			password: "",
			bio: "",
		});
	});

	test("required text fields are invalid when omitted", async () => {
		const form = Form.from({ name: Field.text(), bio: Field.textarea() });
		const result = formInvalid(await form.parse(new FormData()));

		expect(result.issues.map((issue) => issue.path[0])).toEqual([
			"name",
			"bio",
		]);
	});

	test("required blank single-value text fields fail at the base layer", async () => {
		const form = Form.from({
			name: Field.text(),
			email: Field.email(),
			bio: Field.textarea(),
		});
		const data = new FormData();

		data.set("name", "");
		data.set("email", "");
		data.set("bio", "");

		const result = formInvalid(await form.parse(data));

		expect(result.issues.map((issue) => issue.path[0])).toEqual([
			"name",
			"email",
			"bio",
		]);
		expect(result.issues.map((issue) => issue.expected)).toEqual([
			"string",
			"string",
			"string",
		]);
		expect(result.issues.map((issue) => issue.message)).toEqual([
			"Required field",
			"Required field",
			"Required field",
		]);
	});

	test("invalid FormData parse encodes issues-only _form by default", async () => {
		const form = Form.from({
			name: Field.text(),
			role: Field.radio(["reader", "admin"]),
			password: Field.password(),
			avatar: Field.file(),
		});
		const data = new FormData();
		const file = new File(["x"], "a.txt", { type: "text/plain" });

		data.set("name", "ross");
		data.set("role", "owner");
		data.set("password", "secret");
		data.append("avatar", file);

		const result = formInvalid(await form.parse(data));
		const state = decodeState(result.search);

		expect(result.search?.[0]).toBe("_form");
		expect(state.values).toBeUndefined();
		expect(state.id).toBeTruthy();
		expect(state.issues?.length).toBeGreaterThan(0);
	});

	test("invalid parse persists only opted-in values", async () => {
		const form = Form.from({
			name: Field.text().persist().min(2),
			role: Field.radio(["reader", "admin"]).persist(),
			password: Field.password(),
		});
		const data = new FormData();

		data.set("name", "x");
		data.set("role", "owner");
		data.set("password", "secret");

		const result = formInvalid(await form.parse(data));
		const state = decodeState(result.search);

		expect(result.search?.[0]).toBe("_form");
		expect(state.values?.name).toBe("x");
		expect(state.values?.role).toBe("owner");
		expect(state.values?.password).toBeUndefined();
		expect(state.id).toBeTruthy();
		expect(state.issues?.length).toBeGreaterThan(0);
	});

	test("blank opted-in text values are omitted from invalid state", async () => {
		const form = Form.from({
			name: Field.text().persist().min(2),
			role: Field.radio(["reader", "admin"]).persist(),
		});
		const data = new FormData();

		data.set("name", "");
		data.set("role", "owner");

		const result = formInvalid(await form.parse(data));
		const state = decodeState(result.search);

		expect(state.values?.name).toBeUndefined();
		expect(state.values?.role).toBe("owner");
	});

	test("invalid URLSearchParams parse encodes issues-only _form by default", async () => {
		const form = Form.from({
			name: Field.text(),
			role: Field.radio(["reader", "admin"]),
		});
		const params = new URLSearchParams();

		params.set("name", "ross");
		params.set("role", "owner");

		const result = formInvalid(await form.parse(params));
		const state = decodeState(result.search);

		expect(result.search?.[0]).toBe("_form");
		expect(state.values).toBeUndefined();
		expect(state.issues?.length).toBeGreaterThan(0);
	});

	test("oversize persisted values fall back to issues-only _form state", async () => {
		const notes = `notes-${"a".repeat(5000)}`;
		const form = Form.from({
			[notes]: Field.text().persist(),
			role: Field.radio(["reader", "admin"]),
		});
		const data = new FormData();

		data.set(notes, "kept");
		data.set("role", "owner");

		const result = formInvalid(await form.parse(data));
		const state = decodeState(result.search);

		expect(result.search?.[0]).toBe("_form");
		expect(state.values).toBeUndefined();
		expect(state.issues?.length).toBeGreaterThan(0);
	});

	test("invalid URL _form state is ignored when rendering fields", async () => {
		const form = Form.from({
			name: Field.text().persist(),
			email: Field.email(),
			role: Field.radio(["reader", "admin"]),
		});
		const data = new FormData();

		data.set("name", "ross");
		data.set("email", "ross@example.com");
		data.set("role", "owner");

		const result = formInvalid(await form.parse(data));
		const tampered = {
			...decodeState(result.search),
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

	test("render state restores only opted-in values", async () => {
		const form = Form.from({
			name: Field.text().persist(),
			email: Field.email(),
			role: Field.radio(["reader", "admin"]),
		});
		const data = new FormData();

		data.set("name", "ross");
		data.set("email", "ross@example.com");
		data.set("role", "owner");

		const result = formInvalid(await form.parse(data));
		const url = new URL("https://example.com/form");

		url.searchParams.set("_form", result.search![1]);

		const name = await new Render(null).string(
			form.Field({ name: "name", state: url }),
		);
		const email = await new Render(null).string(
			form.Field({ name: "email", state: url }),
		);

		expect(name.includes('value="ross"')).toBe(true);
		expect(email.includes('value="ross@example.com"')).toBe(false);
	});

	test("render state reads matching query params from the URL", async () => {
		const form = Form.from({
			q: Field.search(),
			sort: Field.select(["relevance", "newest"]),
			inStock: Field.checkbox(),
		});
		const url = new URL(
			"https://example.com/search?q=travel+backpack&sort=newest&inStock=on",
		);

		const q = await new Render(null).string(
			form.Field({ name: "q", state: url }),
		);
		const sort = await new Render(null).string(
			form.Field({ name: "sort", state: url }),
		);
		const inStock = await new Render(null).string(
			form.Field({ name: "inStock", state: url }),
		);

		expect(q.includes('value="travel backpack"')).toBe(true);
		expect(sort.includes('<option selected value="newest">')).toBe(true);
		expect(inStock.includes("checked")).toBe(true);
	});

	test("query params fill GET form state alongside _form issues", async () => {
		const form = Form.from({
			q: Field.search().min(2),
			sort: Field.select(["relevance", "newest"]),
		});
		const params = new URLSearchParams();

		params.set("q", "travel backpack");
		params.set("sort", "oldest");

		const result = formInvalid(await form.parse(params));
		const url = new URL("https://example.com/search");

		url.searchParams.set("q", "travel backpack");
		url.searchParams.set("sort", "oldest");
		url.searchParams.set("_form", result.search![1]);

		const q = await new Render(null).string(
			form.Field({ name: "q", state: url }),
		);
		const sort = await new Render(null).string(
			form.Field({ name: "sort", state: url }),
		);

		expect(q.includes('value="travel backpack"')).toBe(true);
		expect(sort.includes("aria-invalid")).toBe(true);
	});

	test("tampered _form state does not restore non-persisted fields", async () => {
		const form = Form.from({
			name: Field.text().persist(),
			email: Field.email(),
			password: Field.password(),
			role: Field.radio(["reader", "admin"]),
		});
		const data = new FormData();

		data.set("name", "ross");
		data.set("email", "ross@example.com");
		data.set("password", "secret");
		data.set("role", "owner");

		const result = formInvalid(await form.parse(data));
		const url = new URL("https://example.com/form");

		url.searchParams.set(
			"_form",
			Codec.Base64Url.encode(
				Codec.encode(
					JSON.stringify({
						...decodeState(result.search),
						values: {
							name: "ross",
							email: "ross@example.com",
							password: "secret",
						},
					} satisfies Form.State),
				),
			),
		);

		const name = await new Render(null).string(
			form.Field({ name: "name", state: url }),
		);
		const email = await new Render(null).string(
			form.Field({ name: "email", state: url }),
		);
		const password = await new Render(null).string(
			form.Field({ name: "password", state: url }),
		);

		expect(name.includes('value="ross"')).toBe(true);
		expect(email.includes('value="ross@example.com"')).toBe(false);
		expect(password.includes('value="secret"')).toBe(false);
	});

	test("forced file persistence still does not serialize file values", async () => {
		const avatar = (
			Field.file() as Field.Any & { persist(): Field.Any }
		).persist();
		const form = Form.from({
			name: Field.text().persist(),
			role: Field.radio(["reader", "admin"]),
			avatar,
		});
		const data = new FormData();

		data.set("name", "ross");
		data.set("role", "owner");
		data.append(
			"avatar",
			new File(["x"], "avatar.txt", { type: "text/plain" }),
		);

		const result = formInvalid(await form.parse(data));
		const state = decodeState(result.search);

		expect(state.values?.name).toBe("ross");
		expect(state.values?.avatar).toBeUndefined();
	});

	test("malformed URL _form issues are ignored when rendering fields", async () => {
		const form = Form.from({
			name: Field.text(),
			role: Field.radio(["reader", "admin"]),
		});
		const data = new FormData();

		data.set("name", "ross");
		data.set("role", "owner");

		const result = formInvalid(await form.parse(data));
		const state = decodeState(result.search);
		const url = new URL("https://example.com/form");

		url.searchParams.set(
			"_form",
			Codec.Base64Url.encode(
				Codec.encode(JSON.stringify({ ...state, issues: [{}] })),
			),
		);

		const html = await new Render(null).string(
			form.Field({ name: "name", state: url }),
		);

		expect(html.includes('name="name"')).toBe(true);
		expect(html.includes("aria-invalid")).toBe(false);
	});

	test("form shape methods extend, pick, and omit preserve parse behavior", async () => {
		const extended = Form.from({ a: Field.text() }).extend({
			b: Field.checkbox(),
		});
		const picked = Form.from({
			a: Field.text(),
			b: Field.number(),
			c: Field.checkbox(),
		}).pick(["a", "c"]);
		const omitted = Form.from({
			a: Field.text(),
			b: Field.number(),
			c: Field.checkbox(),
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

		expect(valid(await extended.parse(extendedData))).toEqual({
			a: "x",
			b: true,
		});
		expect(valid(await picked.parse(pickedData))).toEqual({ a: "x", c: true });
		expect(valid(await omitted.parse(omittedData))).toEqual({
			a: "x",
			c: true,
		});
	});

	test("form extend accepts another form schema", async () => {
		const base = Form.from({ a: Field.text() });
		const extra = Form.from({ b: Field.checkbox() });
		const extended = base.extend(extra);
		const data = new FormData();

		data.set("a", "x");
		data.set("b", "on");

		const result = valid(await extended.parse(data));

		expect(result).toEqual({ a: "x", b: true });
	});

	test("form field helper APIs stay available after pick", () => {
		const form = Form.from({ a: Field.text(), b: Field.number() }).pick(["a"]);

		expect(typeof form.Field).toBe("function");
		expect(typeof form.component({ name: "a" }).Control).toBe("function");
	});

	test("file and files fields parse file values", async () => {
		const single = Form.from({ upload: Field.file() });
		const many = Form.from({ uploads: Field.files() });
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

	test("field parts metadata reflects field cardinality", () => {
		expect(Field.text().parts).toBe(1);
		expect(Field.checkbox().parts).toBe(1);
		expect(Field.file().stream().parts).toBe(1);
		expect(Field.checkboxes(["a", "b", "c"]).parts).toBe(3);
		expect(Field.multiselect(["a", "b"]).parts).toBe(2);
		expect(Field.files().parts).toBe(Infinity);
	});

	test("form parts sums field cardinality and preserves infinity", () => {
		expect(
			Form.from({
				name: Field.text(),
				roles: Field.checkboxes(["reader", "admin"]),
				tags: Field.multiselect(["a", "b", "c"]),
				license: Field.file().stream(),
			}).parts,
		).toBe(7);
		expect(
			Form.from({ name: Field.text(), uploads: Field.files() }).parts,
		).toBe(Infinity);
	});

	test("multipart parse returns validated data and streamed parts together", async () => {
		const form = Form.from({
			name: Field.text(),
			rules: Field.checkbox(),
			license: Field.file().stream(),
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
		if (!result.stream) throw new Error("Expected streamed parts");

		for await (const part of result.stream) {
			expect(part.name).toBe("license");
			expect(part.filename).toBe("a.txt");
			expect((await part.bytes()).length).toBe(3);
			break;
		}
	});

	test("multipart parse does not expose parts when non-part fields are invalid", async () => {
		const form = Form.from({
			name: Field.text().min(2),
			license: Field.file().stream(),
		});
		const body = new FormData();

		body.set("name", "x");
		body.set("license", new File(["abc"], "a.txt", { type: "text/plain" }));

		const multipart = new Multipart(
			new Request("http://localhost/upload", { method: "POST", body }),
		);
		const result = formInvalid(await form.parse(multipart));
		expect(result.stream).toBeUndefined();
	});

	test("multipart parse adds issues for unexpected field names", async () => {
		const form = Form.from({ name: Field.text() });
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
		const form = Form.from({ name: Field.text() });
		const data = new FormData();

		data.set("name", "ross");
		data.set("extra", "x");
		const result = formInvalid(await form.parse(data));

		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]?.path[0]).toBe("extra");
	});

	test("FormData parse aggregates all unexpected field names", async () => {
		const form = Form.from({ name: Field.text() });
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
		const form = Form.from({ name: Field.text() });
		const params = new URLSearchParams();

		params.set("name", "ross");
		params.set("extra", "x");

		const result = formValid(await form.parse(params));

		expect(result.data).toEqual({ name: "ross" });
	});
});
