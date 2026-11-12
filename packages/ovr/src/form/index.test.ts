import { jsx } from "../jsx/index.js";
import { Markup } from "../markup/index.js";
import { Multipart } from "../multipart/index.js";
import { Schema } from "../schema/index.js";
import { Codec } from "../util/index.js";
import { Field, Form, query, taken } from "./index.js";
import { describe, expect, expectTypeOf, test } from "vitest";

type FormValid<S extends Field.Shape> = Extract<
	Field.Parse.Result<S>,
	{ data: Field.Parse.Data<S> }
>;

type FormInvalid<S extends Field.Shape> = Exclude<
	Field.Parse.Result<S>,
	FormValid<S>
>;

const valid = <T>(result: Schema.Parse.Result<T>): T => {
	if ("issues" in result) throw new Error("Expected no issues");
	return result.data;
};

const formValid = <S extends Field.Shape>(result: Field.Parse.Result<S>) => {
	if (result.issues) throw new Error("Expected no issues");
	return result as FormValid<S>;
};

const formInvalid = <S extends Field.Shape>(result: Field.Parse.Result<S>) => {
	if (!result.issues) throw new Error("Expected issues");
	return result as FormInvalid<S>;
};

const decodeState = <S extends Field.Shape>(
	search: Field.Parse.Result.Search,
) => {
	if (!search) throw new Error("Expected _form search state");

	return JSON.parse(
		Codec.decode(Codec.Base64Url.decode(search[0][1])),
	) as Field.State<S>;
};

describe("Form schema", () => {
	test("parses mixed field types", async () => {
		const form = new Form({
			name: Field.text(),
			age: Field.number(),
			active: Field.checkbox(),
			date: Field.date(),
			roles: Field.checkboxes(["reader", "admin"]),
			level: Field.radio(["junior", "senior"]),
			tags: Field.select(["a", "b", "c"]).multiple(),
			bio: Field.textarea(),
		});
		const data = new FormData();

		data.set("name", "ross");
		data.set("age", "31");
		data.set("active", "on");
		data.set("date", "2026-11-12");
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
			date: "2026-11-12",
			roles: ["reader", "admin"],
			level: "senior",
			tags: ["a", "c"],
			bio: "hello",
		});
	});

	test("parses mixed field types from URLSearchParams", async () => {
		const form = new Form({
			name: Field.text(),
			age: Field.number(),
			active: Field.checkbox(),
			roles: Field.checkboxes(["reader", "admin"]),
			level: Field.radio(["junior", "senior"]),
			tags: Field.select(["a", "b", "c"]).multiple(),
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
		const form = new Form({ active: Field.checkbox() });
		expect(valid(await form.parse(new FormData()))).toEqual({ active: false });
	});

	test("blank number fields are treated as missing during form parsing", async () => {
		const form = new Form({
			age: Field.number().optional(),
			count: Field.number().default(5),
		});
		const data = new FormData();

		data.set("age", "");
		data.set("count", "");

		const result = formValid(await form.parse(data)).data satisfies {
			age?: number;
			count: number;
		};

		expect(result).toEqual({ count: 5 });
	});

	test("empty file inputs are treated as missing during form parsing", async () => {
		const form = new Form({
			license: Field.file().optional(),
			uploads: Field.file().multiple().optional(),
		});
		const data = new FormData();
		const empty = new File([""], "", { type: "application/octet-stream" });

		data.set("license", empty);
		data.append("uploads", empty);

		const result = formValid(await form.parse(data)).data satisfies {
			license?: File;
			uploads?: File[];
		};

		expect(result).toEqual({});
	});

	test("zero-byte named files are preserved during form parsing", async () => {
		const form = new Form({ license: Field.file() });
		const data = new FormData();
		const file = new File([""], "license.pdf", { type: "application/pdf" });

		data.set("license", file);

		expect(valid(await form.parse(data))).toEqual({ license: file });
	});

	test("missing multi-value fields are invalid by default", async () => {
		const form = new Form({
			roles: Field.checkboxes(["reader", "admin"]),
			tags: Field.select(["a", "b", "c"]).multiple(),
			uploads: Field.file().multiple(),
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
			"Select an option",
			"Select an option",
			"Required field",
		]);
	});

	test("missing multi-value fields respect optional and default", async () => {
		const form = new Form({
			roles: Field.checkboxes(["reader", "admin"]).optional(),
			tags: Field.select(["a", "b", "c"]).multiple().default(["a"]),
			uploads: Field.file().multiple().optional(),
		});

		expect(valid(await form.parse(new FormData()))).toEqual({ tags: ["a"] });
	});

	test("blank date-like fields are treated as missing during form parsing", async () => {
		const form = new Form({
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
			time: "09:00",
			datetime: "2026-09-01T09:00",
			month: "2026-09",
			week: "2026-W36",
		});
	});

	test("blank date-like search params are treated as missing", async () => {
		const form = new Form({
			date: Field.date().optional(),
			time: Field.time().default("09:00"),
		});
		const params = new URLSearchParams();

		params.set("date", "");
		params.set("time", "");

		expect(valid(await form.parse(params))).toEqual({ time: "09:00" });
	});

	test("blank single-value text fields are treated as missing", async () => {
		const form = new Form({
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
			search: "fallback",
			tel: "555-0100",
			color: "#000000",
			hidden: "token",
			url: "https://example.com",
		});
	});

	test("blank single-value text search params are treated as missing", async () => {
		const form = new Form({
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
			url: "https://example.com",
		});
	});

	test("default empty strings still resolve after blank submissions", async () => {
		const form = new Form({
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
		const form = new Form({ name: Field.text(), bio: Field.textarea() });
		const result = formInvalid(await form.parse(new FormData()));

		expect(result.issues.map((issue) => issue.path[0])).toEqual([
			"name",
			"bio",
		]);
	});

	test("required single-value non-text fields use the required message, choices ask to select", async () => {
		const form = new Form({
			age: Field.number(),
			role: Field.radio(["reader", "admin"]),
			sort: Field.select(["relevance", "newest"]),
			avatar: Field.file(),
		});
		const result = formInvalid(await form.parse(new FormData()));

		expect(result.issues.map((issue) => issue.path[0])).toEqual([
			"age",
			"role",
			"sort",
			"avatar",
		]);
		expect(result.issues.map((issue) => issue.message)).toEqual([
			"Required field",
			"Select an option",
			"Select an option",
			"Required field",
		]);
	});

	test("a choice that is not offered asks to select an option, not for a value", async () => {
		const form = new Form({
			role: Field.radio(["reader", "admin"]),
			sort: Field.select(["relevance", "newest"]),
			roles: Field.checkboxes(["reader", "admin"]),
			tags: Field.select(["a", "b"]).multiple(),
		});
		const data = new FormData();

		data.set("role", "owner");
		data.set("sort", "oldest");
		data.set("roles", "owner");
		data.set("tags", "z");

		const result = formInvalid(await form.parse(data));

		expect(result.issues.map((issue) => issue.path[0])).toEqual([
			"role",
			"sort",
			"roles",
			"tags",
		]);
		expect(new Set(result.issues.map((issue) => issue.message))).toEqual(
			new Set(["Select an option"]),
		);
	});

	test("blank single-value select and radio fields are treated as missing", async () => {
		const form = new Form({
			role: Field.radio(["reader", "admin"]),
			sort: Field.select(["relevance", "newest"]),
		});
		const data = new FormData();

		data.set("role", "");
		data.set("sort", "");

		const result = formInvalid(await form.parse(data));

		expect(result.issues.map((issue) => issue.path[0])).toEqual([
			"role",
			"sort",
		]);
		expect(result.issues.map((issue) => issue.message)).toEqual([
			"Select an option",
			"Select an option",
		]);
	});

	test("required blank single-value text fields fail at the base layer", async () => {
		const form = new Form({
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
		const form = new Form({
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

		expect(result.search?.[0]?.[0]).toBe("_form");
		expect(state.values).toBeUndefined();
		expect(state.id).toBeTruthy();
		expect(state.issues?.length).toBeGreaterThan(0);
	});

	test("invalid parse persists only opted-in values", async () => {
		const form = new Form({
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

		expect(result.search?.[0]?.[0]).toBe("_form");
		expect(state.values?.name).toBe("x");
		expect(state.values?.role).toBe("owner");
		expect(state.values?.password).toBeUndefined();
		expect(state.id).toBeTruthy();
		expect(state.issues?.length).toBeGreaterThan(0);
	});

	test("blank opted-in text values are kept empty in invalid state, overriding initial values", async () => {
		const form = new Form({
			name: Field.text().persist().min(2),
			role: Field.radio(["reader", "admin"]).persist(),
		});
		const data = new FormData();

		data.set("name", "");
		data.set("role", "owner");

		const result = formInvalid(await form.parse(data));
		const state = decodeState(result.search);

		expect(state.values?.name).toBe("");
		expect(state.values?.role).toBe("owner");
	});

	test("invalid URLSearchParams parse encodes issues-only _form by default", async () => {
		const form = new Form({
			name: Field.text(),
			role: Field.radio(["reader", "admin"]),
		});
		const params = new URLSearchParams();

		params.set("name", "ross");
		params.set("role", "owner");

		const result = formInvalid(await form.parse(params));
		const state = decodeState(result.search);

		expect(result.search?.[0]?.[0]).toBe("_form");
		expect(state.values).toBeUndefined();
		expect(state.issues?.length).toBeGreaterThan(0);
	});

	test("oversize persisted values fall back to issues-only _form state", async () => {
		const notes = `notes-${"a".repeat(5000)}`;
		const form = new Form({
			[notes]: Field.text().persist(),
			role: Field.radio(["reader", "admin"]),
		});
		const data = new FormData();

		data.set(notes, "kept");
		data.set("role", "owner");

		const result = formInvalid(await form.parse(data));
		const state = decodeState(result.search);

		expect(result.search?.[0]?.[0]).toBe("_form");
		expect(state.values).toBeUndefined();
		expect(state.issues?.length).toBeGreaterThan(0);
	});

	test("invalid URL _form state is ignored when rendering fields", async () => {
		const form = new Form({
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

		const html = await Markup.string(form.Field({ name: "name", state: url }));

		expect(html.includes('name="name"')).toBe(true);
		expect(html.includes('value="{')).toBe(false);
		expect(html.includes("aria-invalid")).toBe(false);
	});

	test("render state restores only opted-in values", async () => {
		const form = new Form({
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

		url.searchParams.set("_form", result.search![0][1]);

		const name = await Markup.string(form.Field({ name: "name", state: url }));
		const email = await Markup.string(
			form.Field({ name: "email", state: url }),
		);

		expect(name.includes('value="ross"')).toBe(true);
		expect(email.includes('value="ross@example.com"')).toBe(false);
	});

	test("render state autofocuses only the first invalid field", async () => {
		const form = new Form({
			first: Field.text().min(2),
			second: Field.text().min(2),
		});
		const data = new FormData();

		data.set("first", "x");
		data.set("second", "y");

		const result = formInvalid(await form.parse(data));
		const url = new URL("https://example.com/form");

		url.searchParams.set("_form", result.search![0][1]);

		const html = await Markup.string(form.Fields({ state: url }));
		const autofocus = html.match(/autofocus/g) ?? [];

		expect(autofocus).toHaveLength(1);
		expect(html.includes('<input id="first" required autofocus')).toBe(true);
		expect(html.includes('<input id="second" required autofocus')).toBe(false);
	});

	test("render marks controls that can't be left empty as required", async () => {
		const form = new Form({
			text: Field.text(),
			optional: Field.text().optional(),
			fallback: Field.text().default("x"),
			number: Field.number(),
			file: Field.file(),
			agree: Field.checkbox(),
			tags: Field.checkboxes(["a", "b"]),
			size: Field.radio(["s", "m"]),
			kinds: Field.select(["a", "b"]).multiple(),
			token: Field.hidden(),
		});
		const html = await Markup.string(form.Fields());
		const required = (name: string) =>
			[...html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)]
				.map(([tag]) => tag)
				.filter((tag) => tag.includes(`name="${name}"`))
				.map((tag) => / required[ >]/.test(tag));

		expect(required("text")).toEqual([true]);
		expect(required("optional")).toEqual([false]);
		expect(required("fallback")).toEqual([false]);
		expect(required("number")).toEqual([true]);
		expect(required("file")).toEqual([true]);
		expect(required("agree")).toEqual([false]);
		expect(required("tags")).toEqual([false, false]);
		expect(required("size")).toEqual([true, true]);
		expect(required("kinds")).toEqual([true]);
		expect(required("token")).toEqual([false]);

		expect(
			await Markup.string(form.Field({ name: "text", required: false })),
		).not.toContain("required");
	});

	test("render state without issues does not autofocus the first field", async () => {
		const form = new Form({ first: Field.text(), second: Field.text() });
		const url = new URL("https://example.com/form");

		url.searchParams.set("first", "ross");

		const html = await Markup.string(form.Fields({ state: url }));
		const autofocus = html.match(/autofocus/g) ?? [];

		expect(autofocus).toHaveLength(0);
	});

	test("a description is shown under its control, described to agents, and read with an issue", async () => {
		const form = new Form({
			url: Field.url().label("URL").describe("An http or https address."),
			due: Field.date().describe("When it is due"),
			id: Field.hidden().describe("The bookmark to change"),
			size: Field.radio(["s", "m"]).describe("Pick one"),
			plain: Field.text(),
		});

		// people: a paragraph after the control, which the control points to
		expect(await Markup.string(form.Field({ name: "url" }))).toBe(
			'<div><label for="url">URL</label><input id="url" required aria-describedby="url-description" type="url" name="url"><p id="url-description" data-description>An http or https address.</p></div>',
		);
		// a group's after its legend, before its options, and nothing for a
		// hidden field or without one
		expect(await Markup.string(form.Field({ name: "size" }))).toMatch(
			/^<fieldset><legend>size<\/legend><p id="size-description" data-description>Pick one<\/p><div>/,
		);
		expect(await Markup.string(form.Field({ name: "id" }))).toBe(
			'<input type="hidden" name="id">',
		);
		expect(await Markup.string(form.Field({ name: "plain" }))).not.toContain(
			"description",
		);

		// with an issue, the control is described by both, the description first
		const result = formInvalid(await form.parse(new FormData()));
		const url = new URL("https://example.com/form");
		url.searchParams.set("_form", result.search![0][1]);
		const invalid = await Markup.string(
			form.Field({ name: "url", state: url }),
		);
		expect(invalid).toContain('aria-describedby="url-description url-issue"');
		expect(invalid.indexOf('id="url-description"')).toBeLessThan(
			invalid.indexOf('id="url-issue"'),
		);

		// a part of its own, for a custom layout
		const part = form.component({ name: "url" });
		expect(await Markup.string(part.Description({ class: "muted" }))).toBe(
			'<p id="url-description" data-description class="muted">An http or https address.</p>',
		);

		// agents: the field's description as written, before a picker's format,
		// and for a hidden field too
		expect(
			Schema.object(form.shape).toJsonSchema({
				io: "input",
				unrepresentable: "any",
			}).properties,
		).toMatchObject({
			url: { title: "URL", description: "An http or https address." },
			due: { description: "When it is due. Date as YYYY-MM-DD." },
			id: { description: "The bookmark to change" },
		});
	});

	test("taken() is kept by what follows, and is for values people read", () => {
		const field = Field.text()
			.taken("Someone already has this username")
			.label("Username")
			.refine((v) => v.length > 2, "Too short")
			.optional();
		expect(field[taken]).toBe("Someone already has this username");
		expect(Field.text()[taken]).toBeUndefined();
		// @ts-expect-error A password is never shown as taken
		Field.password().taken("Taken");
		// @ts-expect-error Nor is a file
		Field.file().taken("Taken");
	});

	test("a label and a description are chained in any order, and kept by what follows", async () => {
		const field = Field.text()
			.control({ placeholder: "Title" })
			.describe("A short name")
			.max(40)
			.label("Title")
			.persist()
			.optional();
		const form = new Form({ title: field });

		expect(await Markup.string(form.Field({ name: "title" }))).toBe(
			'<div><label for="title">Title</label><input id="title" aria-describedby="title-description" type="text" placeholder="Title" name="title"><p id="title-description" data-description>A short name</p></div>',
		);
		expect(
			Schema.object(form.shape).toJsonSchema({ io: "input" }).properties,
		).toEqual({
			title: {
				type: "string",
				maxLength: 40,
				title: "Title",
				description: "A short name",
			},
		});

		// a field is made without arguments but its choices, and a label and
		// a description are what it means, not attributes of its control
		// @ts-expect-error - use control()
		Field.text({ placeholder: "Title" });
		// @ts-expect-error - use label()
		Field.text().control({ label: "Title" });
		// @ts-expect-error - use describe()
		Field.select(["a", "b"]).control({ description: "Pick one" });
		// @ts-expect-error - the field is its type
		Field.text().control({ type: "email" });

		// attributes add up, and one form's are passed when it renders
		const wide = Field.textarea()
			.control({ rows: 3 })
			.control({ class: "wide" });
		expect(
			await Markup.string(
				new Form({ note: wide }).Field({ name: "note", rows: 8 }),
			),
		).toBe(
			'<div><label for="note">note</label><textarea id="note" required rows="8" class="wide" name="note"></textarea></div>',
		);
	});

	test("multiple() takes more than one file or option, and only from a field that takes one", async () => {
		const form = new Form({
			photos: Field.file().multiple(),
			colors: Field.select(["red", "green", "blue"]).multiple().optional(),
		});
		const data = new FormData();
		data.append("photos", new File(["a"], "a.txt"));
		data.append("photos", new File(["b"], "b.txt"));
		data.append("colors", "red");
		data.append("colors", "blue");
		const result = await form.parse(data);

		expect(result.issues).toBeUndefined();
		expect(result.data?.colors).toEqual(["red", "blue"]);
		expect(result.data?.photos.map((file) => file.name)).toEqual([
			"a.txt",
			"b.txt",
		]);
		expect(await Markup.string(form.Field({ name: "colors" }))).toContain(
			'<select id="colors" multiple name="colors">',
		);

		void (() => {
			// @ts-expect-error - one value per field, as text
			Field.text().multiple();
			// @ts-expect-error - optional applies to the values, so it comes after
			Field.select(["a", "b"]).optional().multiple();
		});
	});

	test("field label metadata renders text without leaking to controls", async () => {
		const form = new Form({
			email: Field.email().label("Email Address"),
			role: Field.radio(["reader", "admin"]).label("Role"),
		});

		const email = await Markup.string(form.Field({ name: "email" }));
		const role = await Markup.string(form.Field({ name: "role" }));

		expect(email.includes(">Email Address</label>")).toBe(true);
		expect(email.includes(' label="Email Address"')).toBe(false);
		expect(role.includes("<legend>Role</legend>")).toBe(true);
		expect(role.includes(' label="Role"')).toBe(false);
	});

	test("a GET route's form reads matching query params from the URL", async () => {
		const form = new Form({
			q: Field.search(),
			sort: Field.select(["relevance", "newest"]),
			inStock: Field.checkbox(),
		})[query]();
		const url = new URL(
			"https://example.com/search?q=travel+backpack&sort=newest&inStock=on",
		);

		const q = await Markup.string(form.Field({ name: "q", state: url }));
		const sort = await Markup.string(form.Field({ name: "sort", state: url }));
		const inStock = await Markup.string(
			form.Field({ name: "inStock", state: url }),
		);

		expect(q.includes('value="travel backpack"')).toBe(true);
		expect(sort.includes('<option selected value="newest">')).toBe(true);
		expect(inStock.includes("checked")).toBe(true);
	});

	test("query params fill GET form state alongside _form issues", async () => {
		const form = new Form({
			q: Field.search().min(2),
			sort: Field.select(["relevance", "newest"]),
		})[query]();
		const params = new URLSearchParams();

		params.set("q", "travel backpack");
		params.set("sort", "oldest");

		const result = formInvalid(await form.parse(params));
		const url = new URL("https://example.com/search");

		url.searchParams.set("q", "travel backpack");
		url.searchParams.set("sort", "oldest");
		url.searchParams.set("_form", result.search![0][1]);

		const q = await Markup.string(form.Field({ name: "q", state: url }));
		const sort = await Markup.string(form.Field({ name: "sort", state: url }));

		expect(q.includes('value="travel backpack"')).toBe(true);
		expect(sort.includes("aria-invalid")).toBe(true);
	});

	test("tampered _form state does not restore non-persisted fields", async () => {
		const form = new Form({
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
					} satisfies Field.State),
				),
			),
		);

		const name = await Markup.string(form.Field({ name: "name", state: url }));
		const email = await Markup.string(
			form.Field({ name: "email", state: url }),
		);
		const password = await Markup.string(
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
		const form = new Form({
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
		const form = new Form({
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

		const html = await Markup.string(form.Field({ name: "name", state: url }));

		expect(html.includes('name="name"')).toBe(true);
		expect(html.includes("aria-invalid")).toBe(false);
	});

	test("file and files fields parse file values", async () => {
		const single = new Form({ upload: Field.file() });
		const many = new Form({ uploads: Field.file().multiple() });
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
		expect(Field.select(["a", "b"]).multiple().parts).toBe(2);
		expect(Field.file().multiple().parts).toBe(Infinity);
	});

	test("form parts sums field cardinality and preserves infinity", () => {
		expect(
			new Form({
				name: Field.text(),
				roles: Field.checkboxes(["reader", "admin"]),
				tags: Field.select(["a", "b", "c"]).multiple(),
				license: Field.file().stream(),
			}).parts,
		).toBe(7);
		expect(
			new Form({ name: Field.text(), uploads: Field.file().multiple() }).parts,
		).toBe(Infinity);
	});

	test("multipart parse returns validated data and streamed parts together", async () => {
		const form = new Form({
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
		const form = new Form({
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
		const form = new Form({ name: Field.text() });
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
		const form = new Form({ name: Field.text() });
		const data = new FormData();

		data.set("name", "ross");
		data.set("extra", "x");
		const result = formInvalid(await form.parse(data));

		expect(result.issues).toHaveLength(1);
		expect(result.issues[0]?.path[0]).toBe("extra");
	});

	test("names of inherited properties are unexpected fields too", async () => {
		const form = new Form({ name: Field.text() });
		const data = new FormData();

		data.set("name", "ross");
		data.set("constructor", "x");
		data.set("toString", "y");
		const result = formInvalid(await form.parse(data));

		expect(result.issues.map((issue) => issue.path[0])).toEqual(
			expect.arrayContaining(["constructor", "toString"]),
		);
	});

	test("FormData parse aggregates all unexpected field names", async () => {
		const form = new Form({ name: Field.text() });
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
		const form = new Form({ name: Field.text() });
		const params = new URLSearchParams();

		params.set("name", "ross");
		params.set("extra", "x");

		const result = formValid(await form.parse(params));

		expect(result.data).toEqual({ name: "ross" });
	});
});

test("a description given before multiple() describes the field", async () => {
	const tags = Field.select(["a", "b"]).describe("Pick some").multiple();
	const form = new Form({ tags });

	expect(tags.description).toBe("Pick some");
	expect(Schema.object({ tags }).toJsonSchema().properties).toEqual({
		tags: expect.objectContaining({
			description: "Pick some",
			items: { enum: ["a", "b"] },
		}),
	});
	expect(await Markup.string(form.Fields())).toContain("Pick some");
});

describe("choices a schema checks", () => {
	const a = "0b8f5d0a-6f0e-4d1f-9a8e-2f2b5c1d3e4f";
	const b = "1c9e6e1b-7a1f-4e2a-8b9f-3a3c6d2e4f50";
	const id = Schema.string().uuid();

	test("parse each value with the schema", async () => {
		const form = new Form({
			photos: Field.checkboxes(id),
			cover: Field.radio(id),
			recipes: Field.select(id).multiple(),
			first: Field.select(id).optional(),
		});
		const data = new FormData();
		data.append("photos", a);
		data.append("photos", b);
		data.set("cover", a);
		data.append("recipes", b);

		const result = formValid(await form.parse(data));
		expectTypeOf(result.data.photos).toEqualTypeOf<string[]>();
		expect(result.data).toEqual({ photos: [a, b], cover: a, recipes: [b] });

		const wrong = new FormData();
		wrong.append("photos", "not-an-id");
		wrong.set("cover", a);
		wrong.append("recipes", a);
		const issues = formInvalid(await form.parse(wrong)).issues;
		expect(issues.map((issue) => issue.path)).toEqual([["photos", 0]]);
	});

	test("render the options given as the form renders", async () => {
		const form = new Form({
			photos: Field.checkboxes(id),
			recipe: Field.select(id),
			tags: Field.checkboxes(["fall", "winter"]),
		});

		const group = await Markup.string(
			form.Field({ name: "photos", options: [a, b] }),
		);
		expect(group).toContain(`type="checkbox" name="photos" value="${a}"`);
		expect(group).toContain(`value="${b}"`);

		const select = await Markup.string(
			form.Field({ name: "recipe", options: [a] }),
		);
		expect(select).toContain(`<option value="${a}">${a}</option>`);

		// a field of fixed choices keeps its own
		const tags = await Markup.string(
			form.Field({ name: "tags", options: ["spring"] }),
		);
		expect(tags).toContain('value="fall"');
		expect(tags).not.toContain("spring");

		// a custom layout labels each choice
		const Photos = form.component({ name: "photos", options: [a] });
		expect(Photos.options).toEqual([a]);
		expect(
			await Markup.string(Photos.Label({ value: a, children: "Card front" })),
		).toBe(`<label for="photos-${a}">Card front</label>`);
	});

	test("describe each value to agents with the schema, without a fixed list", () => {
		const schema = Schema.object({ photos: Field.checkboxes(id) }).toJsonSchema(
			{ io: "input" },
		);

		expect(schema.properties).toMatchObject({
			photos: { type: "array", items: { type: "string", format: "uuid" } },
		});
		expect(JSON.stringify(schema)).not.toContain("enum");
	});
});

test("a select that may be left empty starts with an empty choice", async () => {
	const form = new Form({
		meal: Field.select(["dinner", "side"]).optional(),
		course: Field.select(["dinner", "side"]),
		tags: Field.select(["fall", "winter"]).multiple().optional(),
	});

	expect(await Markup.string(form.Field({ name: "meal" }))).toContain(
		'<select id="meal" name="meal"><option value=""></option><option value="dinner">',
	);
	// a required one keeps the browser's choice of its first, and a
	// multiple one is empty with nothing selected
	expect(await Markup.string(form.Field({ name: "course" }))).not.toContain(
		'value=""',
	);
	expect(await Markup.string(form.Field({ name: "tags" }))).not.toContain(
		'value=""',
	);

	expect(
		formValid(await form.parse(new URLSearchParams("meal=&course=side"))).data,
	).toEqual({ course: "side" });
});

test("a number field sent text asks for a number, left empty it is required", async () => {
	const form = new Form({
		n: Field.number().optional(),
		count: Field.number(),
	});

	const issues = formInvalid(
		await form.parse(new URLSearchParams("n=Keep&count=")),
	).issues;
	expect(issues.map((issue) => [issue.path[0], issue.message])).toEqual([
		["n", "Enter a number"],
		["count", "Required field"],
	]);
});

describe("choices people call by another name", () => {
	const form = new Form({
		meal: Field.select({ dinner: "Dinner", crockpot: "Slow cooker" })
			.optional()
			.control({ placeholder: "Any meal" }),
		effort: Field.radio({ easy: "Easy", constructor: "constructor" }),
		tags: Field.checkboxes({ fall: "Fall", winter: "Winter" }).optional(),
		side: Field.select(Schema.string()).optional(),
		course: Field.select(["dinner", "side"]).control({
			placeholder: "Choose a course",
		}),
	});

	test("are sent by their value and shown by their label", async () => {
		const result = formValid(
			await form.parse(
				new URLSearchParams("meal=crockpot&effort=easy&tags=fall&course=side"),
			),
		);
		expectTypeOf(result.data.meal).toEqualTypeOf<
			"dinner" | "crockpot" | undefined
		>();
		expectTypeOf(result.data.tags).toEqualTypeOf<
			("fall" | "winter")[] | undefined
		>();
		expect(result.data).toEqual({
			meal: "crockpot",
			effort: "easy",
			tags: ["fall"],
			course: "side",
		});
		expect(
			formInvalid(
				await form.parse(
					new URLSearchParams("meal=Slow+cooker&effort=easy&course=side"),
				),
			).issues.map((issue) => issue.path),
		).toEqual([["meal"]]);

		expect(
			await Markup.string(
				form.Field({ name: "meal", values: { meal: "crockpot" } }),
			),
		).toBe(
			'<div><label for="meal">meal</label><select id="meal" name="meal"><option value="">Any meal</option><option value="dinner">Dinner</option><option selected value="crockpot">Slow cooker</option></select></div>',
		);
		expect(await Markup.string(form.Field({ name: "effort" }))).toContain(
			'<input id="effort-easy" required type="radio" name="effort" value="easy"><label for="effort-easy">Easy</label>',
		);
		expect(await Markup.string(form.Field({ name: "tags" }))).toContain(
			'<label for="tags-winter">Winter</label>',
		);

		// a custom layout gets them too, and may still say its own
		const Meal = form.component({ name: "meal" });
		expect(Meal.options).toEqual(["dinner", "crockpot"]);
		expect(await Markup.string(Meal.Option({ value: "crockpot" }))).toBe(
			'<option value="crockpot">Slow cooker</option>',
		);
		expect(
			await Markup.string(Meal.Option({ value: "dinner", children: "Tea" })),
		).toBe('<option value="dinner">Tea</option>');
		// its empty choice is the layout's to write, without the attribute
		expect(await Markup.string(Meal.Control())).toBe(
			'<select id="meal" name="meal"></select>',
		);
	});

	test("are given with the options of a field made from a schema", async () => {
		expect(
			await Markup.string(
				form.Field({
					name: "side",
					options: { "7": "Rice", abc: "Beans" },
					values: { side: "abc" },
					placeholder: "No side",
				}),
			),
		).toBe(
			'<div><label for="side">side</label><select id="side" name="side"><option value="">No side</option><option value="7">Rice</option><option selected value="abc">Beans</option></select></div>',
		);

		// a field's own choices keep their own labels
		expect(
			await Markup.string(
				form.Field({ name: "tags", options: { fall: "Autumn", spring: "x" } }),
			),
		).not.toContain("Autumn");
	});

	test("a select that must be chosen starts empty when it says what to choose", async () => {
		expect(await Markup.string(form.Field({ name: "course" }))).toBe(
			'<div><label for="course">course</label><select id="course" required name="course"><option value="">Choose a course</option><option value="dinner">dinner</option><option value="side">side</option></select></div>',
		);
	});

	test("tell agents each value's label", () => {
		const schema = Schema.object(form.shape).toJsonSchema({ io: "input" });

		expect(schema.properties).toMatchObject({
			meal: {
				enum: ["dinner", "crockpot"],
				description: "Choices: dinner (Dinner), crockpot (Slow cooker).",
			},
			// only where it is not the value itself
			effort: {
				enum: ["easy", "constructor"],
				description: "Choices: easy (Easy).",
			},
			tags: {
				type: "array",
				items: { enum: ["fall", "winter"] },
				description: "Choices: fall (Fall), winter (Winter).",
			},
		});
		expect(
			(schema.properties as Record<string, object>).course,
		).not.toHaveProperty("description");
	});
});

test("a hint is what people read, where the description is what agents read", async () => {
	const form = new Form({
		grams: Field.number()
			.describe("Weight in grams for cups and spoons. Empty for counts.")
			.hint("For cups and spoons")
			.optional(),
		notes: Field.text().describe("Free text, for the cook").hint("").optional(),
		items: Field.list({
			amount: Field.text()
				.describe("As written, for an agent")
				.hint("As written"),
			unit: Field.text().describe("Singular, for an agent").hint("").optional(),
		})
			.describe("Every ingredient, in order")
			.hint("Clear a row to remove it"),
	});

	expect(await Markup.string(form.Field({ name: "grams" }))).toBe(
		'<div><label for="grams">grams</label><input id="grams" aria-describedby="grams-description" type="number" name="grams"><p id="grams-description" data-description>For cups and spoons</p></div>',
	);
	// an empty hint shows nothing, and the control names nothing
	expect(await Markup.string(form.Field({ name: "notes" }))).toBe(
		'<div><label for="notes">notes</label><input id="notes" type="text" name="notes"></div>',
	);

	const items = await Markup.string(form.Field({ name: "items" }));
	expect(items).toContain(
		'<legend>items</legend><p id="items-description" data-description>Clear a row to remove it</p>',
	);
	expect(items).toContain(
		'<p data-description><span>amount</span>: <span id="items.amount-description">As written</span></p>',
	);
	expect(items).toContain(
		'<input id="items.0.unit" type="text" name="items.0.unit" aria-labelledby="items.unit-label">',
	);
	expect(items).not.toContain("agent");

	expect(
		Schema.object(form.shape).toJsonSchema({ io: "input" }).properties,
	).toMatchObject({
		grams: {
			description: "Weight in grams for cups and spoons. Empty for counts.",
		},
		notes: { description: "Free text, for the cook" },
		items: {
			description: "Every ingredient, in order",
			items: {
				properties: {
					amount: { description: "As written, for an agent" },
					unit: { description: "Singular, for an agent" },
				},
			},
		},
	});
});

test("a choice given as the form renders may be labelled with an element", async () => {
	const form = new Form({
		photos: Field.checkboxes(Schema.string()).optional(),
	});

	expect(
		await Markup.string(
			form.Field({
				name: "photos",
				options: {
					a1: jsx("img", { src: "/a1.jpg", alt: "Card front" }),
					b2: "Plain",
				},
				values: { photos: ["a1"] },
			}),
		),
	).toBe(
		"<fieldset><legend>photos</legend>" +
			'<div><input id="photos-a1" type="checkbox" name="photos" checked value="a1"><label for="photos-a1"><img src="/a1.jpg" alt="Card front"></label></div>' +
			'<div><input id="photos-b2" type="checkbox" name="photos" value="b2"><label for="photos-b2">Plain</label></div>' +
			"</fieldset>",
	);
});

test("what is passed to a group is its fieldset's, and each box has what control() set", async () => {
	const form = new Form({
		photos: Field.checkboxes(["a", "b"]).control({ "data-box": true }),
		size: Field.radio(["s", "l"]),
	});

	expect(
		await Markup.string(
			form.Field({ name: "photos", class: "photo-choice", id: "pick" }),
		),
	).toBe(
		'<fieldset class="photo-choice" id="pick"><legend>photos</legend>' +
			'<div><input id="photos-a" type="checkbox" data-box name="photos" value="a"><label for="photos-a">a</label></div>' +
			'<div><input id="photos-b" type="checkbox" data-box name="photos" value="b"><label for="photos-b">b</label></div>' +
			"</fieldset>",
	);
	// required stays each box's
	expect(await Markup.string(form.Field({ name: "size" }))).toContain(
		'<input id="size-s" required type="radio" name="size" value="s">',
	);
	expect(
		await Markup.string(form.Field({ name: "size", required: false })),
	).toBe(
		"<fieldset><legend>size</legend>" +
			'<div><input id="size-s" type="radio" name="size" value="s"><label for="size-s">s</label></div>' +
			'<div><input id="size-l" type="radio" name="size" value="l"><label for="size-l">l</label></div>' +
			"</fieldset>",
	);

	const Size = form.component({ name: "size", class: "sizes" });
	expect(await Markup.string(Size.Root())).toBe(
		'<fieldset class="sizes"></fieldset>',
	);
});

test("each line of a long text is kept, where one long value is not", async () => {
	const form = new Form({
		title: Field.text(),
		steps: Field.textarea().lines().persist(),
		note: Field.textarea().optional().persist(),
	});
	const steps = Array.from({ length: 8 }, (_, i) => `${i} ${"x".repeat(260)}`);

	const state = decodeState<typeof form.shape>(
		formInvalid(
			await form.parse(
				new URLSearchParams({ steps: steps.join("\n"), note: "y".repeat(600) }),
			),
		).search,
	);
	expect(state.values).toEqual({ steps });

	// a line over the limit is not kept, nor the lines with it
	const long = formInvalid(
		await form.parse(new URLSearchParams({ steps: `ok\n${"z".repeat(600)}` })),
	);
	expect(decodeState<typeof form.shape>(long.search).values).not.toHaveProperty(
		"steps",
	);
});

test("a picker's value is checked, since an agent sends what it likes", async () => {
	const form = new Form({
		day: Field.date().optional(),
		at: Field.datetime().optional(),
		month: Field.month().optional(),
		week: Field.week().optional(),
		time: Field.time().optional(),
		color: Field.color().optional(),
	});
	const parse = (values: Record<string, string>) =>
		form.parse(new URLSearchParams(values));

	// what browsers send, with seconds when the picker has them
	for (const values of [
		{ day: "2024-02-29", at: "2026-11-12T08:05", month: "2026-01" },
		{ at: "2026-11-12T23:59:59.999", week: "2026-W53", time: "00:00" },
		{ time: "23:59:30", color: "#A1b2c3" },
		{},
	])
		expect(formValid(await parse(values)).data).toEqual(values);

	const wrong = {
		day: "2026-13-45",
		at: "2026-11-12 08:05",
		month: "2026-13",
		week: "2026-W54",
		time: "24:00",
		color: "red",
	};
	expect(
		formInvalid(await parse(wrong)).issues.map((issue) => [
			issue.path[0],
			issue.message,
		]),
	).toEqual([
		["day", "Enter a date as YYYY-MM-DD"],
		["at", "Enter a date and time as YYYY-MM-DDTHH:mm"],
		["month", "Enter a month as YYYY-MM"],
		["week", "Enter a week as YYYY-Www"],
		["time", "Enter a time as HH:mm"],
		["color", "Enter a color as #rrggbb"],
	]);

	// in another order, a day the month does not have, or not a date at all
	for (const day of ["11/12/2026", "2026-02-30", "2026-06-31", "tomorrow"])
		expect(formInvalid(await parse({ day })).issues).toHaveLength(1);
	for (const at of ["2026-02-30T10:00", "2026-11-12T10:00T10:00", "2026-11-12"])
		expect(formInvalid(await parse({ at })).issues).toHaveLength(1);

	// still a string with its format, to agents
	expect(
		Schema.object(form.shape).toJsonSchema({ io: "input" }).properties,
	).toMatchObject({
		day: { type: "string", format: "date", description: "Date as YYYY-MM-DD." },
		time: { type: "string", description: "Time as HH:mm." },
	});
});

test("updates are what a request sets: a form's every field, an agent's only the ones it gave", async () => {
	const form = new Form({
		title: Field.text(),
		author: Field.text().optional(),
		servings: Field.number().optional(),
		done: Field.checkbox(),
		tags: Field.checkboxes(["fall", "winter"]).optional(),
		steps: Field.textarea().lines().optional(),
		items: Field.list({ name: Field.text() }).optional(),
		kind: Field.select(["a", "b"]).default("a"),
	});

	// a browser sends every control but a box that is not ticked
	const browser = new FormData();
	browser.set("title", "Soup");
	browser.set("author", "");
	browser.set("servings", "4");
	browser.set("steps", "");
	browser.set("items.0.name", "");
	browser.set("kind", "b");
	const person = formValid(await form.parse(browser));
	expect(person.data).toEqual({
		title: "Soup",
		servings: 4,
		done: false,
		kind: "b",
	});
	// emptied is cleared, and an unticked box is false
	expect(person.updates).toEqual({
		title: "Soup",
		author: null,
		servings: 4,
		done: false,
		tags: null,
		steps: null,
		items: null,
		kind: "b",
	});
	expectTypeOf(person.updates).toEqualTypeOf<{
		readonly title?: string | null;
		readonly author?: string | null;
		readonly servings?: number | null;
		readonly done?: boolean | null;
		readonly tags?: ("fall" | "winter")[] | null;
		readonly steps?: string[] | null;
		readonly items?: { name: string }[] | null;
		readonly kind?: "a" | "b" | null;
	}>();

	// a form that renders some of the fields updates only those, and its boxes
	const some = new FormData();
	some.set("title", "Stew");
	expect(formValid(await form.parse(some)).updates).toEqual({
		title: "Stew",
		done: false,
		tags: null,
	});

	// an agent gave two arguments: one to change, one to clear
	const agent = new FormData();
	agent.set("title", "Chili");
	const called = formValid(
		await form.parse(agent, [], new Set(["title", "author"])),
	);
	expect(called.updates).toEqual({ title: "Chili", author: null });
	// the whole record is as before: what was left out is not in it
	expect(called.data).toEqual({ title: "Chili", done: false, kind: "a" });
});

describe("lines", () => {
	const form = new Form({
		steps: Field.textarea().lines(),
		tags: Field.textarea().lines().optional(),
	});

	test("a person's lines and an agent's values are the same array", async () => {
		const typed = formValid(
			await form.parse(
				new URLSearchParams({
					steps: "Chop\r\n\r\n  Fry  \nServe",
					tags: " \n",
				}),
			),
		);
		expectTypeOf(typed.data.steps).toEqualTypeOf<string[]>();
		expectTypeOf(typed.data.tags).toEqualTypeOf<string[] | undefined>();
		expect(typed.data).toEqual({ steps: ["Chop", "Fry", "Serve"] });

		const sent = new FormData();
		sent.append("steps", "Chop");
		sent.append("steps", "Fry");
		expect(formValid(await form.parse(sent)).data).toEqual({
			steps: ["Chop", "Fry"],
		});

		expect(
			formInvalid(await form.parse(new FormData())).issues.map((issue) => [
				issue.path,
				issue.message,
			]),
		).toEqual([[["steps"], "Required field"]]);
	});

	test("render as a textarea with a line for each", async () => {
		expect(
			await Markup.string(
				form.Field({ name: "steps", values: { steps: ["Chop", "Fry"] } }),
			),
		).toContain(
			'<textarea id="steps" required name="steps">Chop\nFry</textarea>',
		);
	});

	test("check each line as the textarea checks its text, and keep what was chained", async () => {
		const short = new Form({
			tags: Field.textarea()
				.max(4, "Too long")
				.label("Tags")
				.describe("One on each line")
				.control({ rows: 3 })
				.lines()
				.persist(),
		});

		const invalid = formInvalid(
			await short.parse(new URLSearchParams({ tags: "fall\nwinter" })),
		);
		expect(invalid.issues.map((issue) => [issue.path, issue.message])).toEqual([
			[["tags", 1], "Too long"],
		]);

		const html = await Markup.string(
			short.Field({
				name: "tags",
				state: new URL(
					`http://localhost/?${new URLSearchParams(invalid.search)}`,
				),
			}),
		);
		expect(html).toContain('<label for="tags">Tags</label>');
		expect(html).toContain(' rows="3" name="tags">fall\nwinter</textarea>');
		expect(html).toContain("One on each line");
		expect(html).toContain("Too long");

		expect(
			Schema.object(short.shape).toJsonSchema({ io: "input" }).properties,
		).toEqual({
			tags: {
				type: "array",
				title: "Tags",
				description: "One on each line",
				items: { type: "string", maxLength: 4 },
			},
		});

		// after lines(), min and max count the lines
		const few = new Form({
			tags: Field.textarea().max(4).lines().min(2).max(3, "At most 3 tags"),
			boxes: Field.checkboxes(["a", "b", "c"]).max(2).optional(),
		});
		expectTypeOf(
			formValid(await few.parse(new URLSearchParams({ tags: "a\nb" }))).data
				.tags,
		).toEqualTypeOf<string[]>();
		expect(
			formInvalid(
				await few.parse(
					new URLSearchParams([
						["tags", "a\nb\nc\nd"],
						["boxes", "a"],
						["boxes", "b"],
						["boxes", "c"],
					]),
				),
			).issues.map((issue) => [issue.path, issue.message]),
		).toEqual([
			[["tags"], "At most 3 tags"],
			[["boxes"], "At most 2"],
		]);
		expect(
			Schema.object(few.shape).toJsonSchema({ io: "input" }).properties,
		).toMatchObject({
			tags: {
				type: "array",
				minItems: 2,
				maxItems: 3,
				items: { type: "string", maxLength: 4 },
			},
			boxes: { type: "array", maxItems: 2 },
		});

		// @ts-expect-error only a textarea has lines
		Field.text().lines();
		// @ts-expect-error optional after, as the list
		Field.textarea().optional().lines();
	});

	test("are an array of strings to agents", () => {
		const schema = Schema.object(form.shape).toJsonSchema({ io: "input" });

		expect(schema.properties).toEqual({
			steps: { type: "array", items: { type: "string" } },
			tags: { type: "array", items: { type: "string" } },
		});
		expect(schema.required).toEqual(["steps"]);
	});
});

describe("a list", () => {
	const id = Schema.string().uuid();
	const a = "0b8f5d0a-6f0e-4d1f-9a8e-2f2b5c1d3e4f";
	const b = "1c9e6e1b-7a1f-4e2a-8b9f-3a3c6d2e4f50";
	const form = new Form({
		dinners: Field.list(Field.select(id)).optional(),
		ingredients: Field.list({
			id: Field.hidden().optional(),
			amount: Field.number().optional(),
			name: Field.text(),
			organic: Field.checkbox(),
		})
			.label("Ingredients")
			.describe("What goes in")
			.persist(),
	});

	test("reads its items in order, an item may repeat, and an empty row is left out", async () => {
		const data = new FormData();
		data.set("dinners.2", a);
		data.set("dinners.0", b);
		data.set("dinners.1", "");
		data.set("dinners.3", b);
		data.set("ingredients.0.amount", "2");
		data.set("ingredients.0.name", "onion");
		// cleared, with the ID its row was rendered with
		data.set("ingredients.1.id", "7");
		data.set("ingredients.1.amount", "");
		data.set("ingredients.1.name", "");
		data.set("ingredients.4.name", "salt");
		data.set("ingredients.4.organic", "on");

		const result = formValid(await form.parse(data));
		expectTypeOf(result.data.dinners).toEqualTypeOf<string[] | undefined>();
		expectTypeOf(result.data.ingredients).toEqualTypeOf<
			{ name: string; organic: boolean; id?: string; amount?: number }[]
		>();
		expect(result.data).toEqual({
			dinners: [b, a, b],
			ingredients: [
				{ amount: 2, name: "onion", organic: false },
				{ name: "salt", organic: true },
			],
		});
	});

	test("needs an item unless it is optional, and each cell reports its own issue", async () => {
		expect(
			formInvalid(await form.parse(new FormData())).issues.map((issue) => [
				issue.path,
				issue.message,
			]),
		).toEqual([[["ingredients"], "Required field"]]);

		const data = new FormData();
		data.set("dinners.0", "not-an-id");
		data.set("ingredients.0.name", "onion");
		data.set("ingredients.1.amount", "some");
		expect(
			formInvalid(await form.parse(data)).issues.map((issue) => [
				issue.path,
				issue.message,
			]),
		).toEqual([
			[["dinners", 0], "Expected UUID"],
			[["ingredients", 1, "amount"], "Enter a number"],
			[["ingredients", 1, "name"], "Required field"],
		]);
	});

	test("takes only the names of its own cells", async () => {
		for (const name of [
			"ingredients.0",
			"ingredients.0.price",
			"ingredients.0.constructor",
			"ingredients.x.name",
			"ingredients.01.name",
			"ingredients.name",
			"dinners.0.id",
			"dinners.",
		]) {
			const data = new FormData();
			data.set("ingredients.0.name", "onion");
			data.set(name, "x");
			expect(
				formInvalid(await form.parse(data)).issues.map((issue) => issue.path),
				name,
			).toEqual([[name]]);
		}
	});

	test("renders a row for each item and an empty one, or as many as it is told", async () => {
		const values = {
			dinners: [a],
			ingredients: [
				{ id: 7, amount: 2, name: "onion", organic: true, added: new Date() },
			],
		};

		const dinners = await Markup.string(
			form.Field({ name: "dinners", values, options: [a, b] }),
		);
		expect(dinners).toBe(
			"<fieldset><legend>dinners</legend>" +
				`<div><label for="dinners.0">1</label><select id="dinners.0" name="dinners.0"><option value=""></option><option selected value="${a}">${a}</option><option value="${b}">${b}</option></select></div>` +
				`<div><label for="dinners.1">2</label><select id="dinners.1" name="dinners.1"><option value=""></option><option value="${a}">${a}</option><option value="${b}">${b}</option></select></div>` +
				"</fieldset>",
		);

		const week = await Markup.string(
			form.Field({ name: "dinners", values, options: [a], rows: 7 }),
		);
		expect(week.match(/<select/g)).toHaveLength(7);
		// every item is shown, however few rows are asked for
		expect(
			(
				await Markup.string(
					form.Field({ name: "dinners", values: { dinners: [a, b] }, rows: 1 }),
				)
			).match(/<select/g),
		).toHaveLength(2);

		const ingredients = await Markup.string(
			form.Field({ name: "ingredients", values }),
		);
		// several fields are a table: a column each, named in its heading
		expect(ingredients).toBe(
			"<fieldset><legend>Ingredients</legend>" +
				// before the rows it explains
				'<p id="ingredients-description" data-description>What goes in</p>' +
				"<div><table>" +
				"<thead><tr>" +
				'<th id="ingredients.amount-label" scope="col">amount</th>' +
				'<th id="ingredients.name-label" scope="col">name</th>' +
				'<th id="ingredients.organic-label" scope="col">organic</th>' +
				"</tr></thead><tbody>" +
				"<tr>" +
				'<td><input type="hidden" name="ingredients.0.id" value="7"><input id="ingredients.0.amount" type="number" name="ingredients.0.amount" aria-labelledby="ingredients.amount-label" value="2"></td>' +
				'<td><input id="ingredients.0.name" type="text" name="ingredients.0.name" aria-labelledby="ingredients.name-label" value="onion"></td>' +
				'<td><input id="ingredients.0.organic" type="checkbox" name="ingredients.0.organic" aria-labelledby="ingredients.organic-label" checked></td>' +
				"</tr><tr>" +
				'<td><input type="hidden" name="ingredients.1.id"><input id="ingredients.1.amount" type="number" name="ingredients.1.amount" aria-labelledby="ingredients.amount-label"></td>' +
				'<td><input id="ingredients.1.name" type="text" name="ingredients.1.name" aria-labelledby="ingredients.name-label"></td>' +
				'<td><input id="ingredients.1.organic" type="checkbox" name="ingredients.1.organic" aria-labelledby="ingredients.organic-label"></td>' +
				"</tr></tbody></table></div>" +
				"</fieldset>",
		);
	});

	test("shows what was sent again, with each issue on its cell", async () => {
		const data = new FormData();
		data.set("ingredients.0.name", "onion");
		data.set("ingredients.3.amount", "2");

		const invalid = formInvalid(await form.parse(data));
		expect(decodeState<typeof form.shape>(invalid.search).values).toEqual({
			ingredients: [
				{ name: "onion", organic: false },
				{ amount: "2", organic: false },
			],
		});

		const state = new URL(
			`http://localhost/?${new URLSearchParams(invalid.search)}`,
		);
		const html = await Markup.string(
			form.Field({ name: "ingredients", state }),
		);
		expect(html).toContain(
			'name="ingredients.0.name" aria-labelledby="ingredients.name-label" value="onion"',
		);
		expect(html).toContain(
			'<input id="ingredients.1.name" autofocus aria-invalid="true" aria-describedby="ingredients.1.name-issue" type="text" name="ingredients.1.name" aria-labelledby="ingredients.name-label"><p id="ingredients.1.name-issue" data-issue="0">Required field</p>',
		);
		// the list has no issue of its own
		expect(html.match(/data-issue/g)).toHaveLength(1);
		expect(html.match(/name="ingredients\.\d\.name"/g)).toHaveLength(3);

		// a list cleared after it had items stays cleared
		const cleared = formInvalid(await form.parse(new FormData()));
		const again = await Markup.string(
			form.Field({
				name: "ingredients",
				state: new URL(
					`http://localhost/?${new URLSearchParams(cleared.search)}`,
				),
				values: { ingredients: [{ name: "onion" }] },
			}),
		);
		expect(again).not.toContain("onion");
		expect(again).toContain(
			'<p id="ingredients-issue" data-issue="0">Required field</p>',
		);
	});

	test("gives a custom layout each row's components", async () => {
		const Dinners = form.component({
			name: "dinners",
			values: { dinners: [b] },
			rows: 2,
		});
		expect(Dinners.rows).toHaveLength(2);
		expect(
			await Markup.string(
				Dinners.rows[0]!.Control({
					children: [
						Dinners.rows[0]!.Option({ value: a, children: "Soup" }),
						Dinners.rows[0]!.Option({ value: b, children: "Stew" }),
					],
				}),
			),
		).toBe(
			`<select id="dinners.0" name="dinners.0"><option value="${a}">Soup</option><option selected value="${b}">Stew</option></select>`,
		);
		expect(await Markup.string(Dinners.Legend())).toBe(
			"<legend>dinners</legend>",
		);

		const Ingredients = form.component({ name: "ingredients" });
		const [row] = Ingredients.rows;
		expect(
			await Markup.string(row!.amount.Control({ "aria-label": "Amount" })),
		).toBe(
			'<input id="ingredients.0.amount" type="number" name="ingredients.0.amount" aria-label="Amount">',
		);
		expectTypeOf(row!.name.Label)
			.parameter(0)
			.toEqualTypeOf<Field.Component.Label | undefined>();
		// @ts-expect-error a row has only the list's fields
		row!.price;
		// @ts-expect-error a list has no control of its own
		Ingredients.Control;
	});

	test("a row laid out by hand is not read with a description it may not render", async () => {
		const described = new Form({
			items: Field.list({ name: Field.text().describe("What to buy") }),
		});

		// the default table names a column in its heading, which holds only
		// the label, and describes it once under the table
		const table = await Markup.string(described.Field({ name: "items" }));
		expect(table).toContain('<th id="items.name-label" scope="col">name</th>');
		expect(table).toContain(
			'<input id="items.0.name" aria-describedby="items.name-description" type="text" name="items.0.name" aria-labelledby="items.name-label">',
		);
		expect(table).toContain(
			'</table></div><p data-description><span>name</span>: <span id="items.name-description">What to buy</span></p></fieldset>',
		);
		expect(table.match(/What to buy/g)).toHaveLength(1);

		const [row] = described.component({ name: "items" }).rows;
		expect(await Markup.string(row!.name.Control())).toBe(
			'<input id="items.0.name" type="text" name="items.0.name">',
		);
		// its issue is still read with it
		const persisted = new Form({
			items: Field.list({
				name: Field.text().describe("What to buy"),
				note: Field.text().optional(),
			}).persist(),
		});
		const sent = new FormData();
		sent.set("items.0.note", "ripe");
		const invalid = formInvalid(await persisted.parse(sent));
		const [again] = persisted.component({
			name: "items",
			state: new URL(
				`http://localhost/?${new URLSearchParams(invalid.search)}`,
			),
		}).rows;
		expect(await Markup.string(again!.name.Control())).toContain(
			'aria-describedby="items.0.name-issue"',
		);
	});

	test("an issue of a row that is not shown again is the list's, and says where", async () => {
		const plain = new Form({
			title: Field.text(),
			items: Field.list({
				amount: Field.text().optional(),
				// said as people know it, by its column's heading
				name: Field.text().label("Ingredient"),
			}),
			ids: Field.list(Field.text().uuid("Not an ID")).optional(),
		});
		const data = new FormData();
		data.set("items.0.name", "onion");
		data.set("items.1.amount", "2");
		data.set("ids.0", "x");

		const invalid = formInvalid(await plain.parse(data));
		// agents and the handler get each issue by its place
		expect(invalid.issues.map((issue) => issue.path)).toEqual([
			["title"],
			["items", 1, "name"],
			["ids", 0],
		]);

		const state = new URL(
			`http://localhost/?${new URLSearchParams(invalid.search)}`,
		);
		const items = await Markup.string(plain.Field({ name: "items", state }));
		expect(items).toContain(
			'<p id="items-issue" data-issue="1">Row 2, Ingredient: Required field</p>',
		);
		// no row has it, since the rows that were sent are gone
		expect(items.match(/data-issue/g)).toHaveLength(1);
		expect(items).not.toContain("aria-invalid");

		expect(await Markup.string(plain.Field({ name: "ids", state }))).toContain(
			'<p id="ids-issue" data-issue="2">Row 1: Not an ID</p>',
		);
	});

	test("what is passed to a list is its fieldset's, and its description follows its legend", async () => {
		const styled = new Form({
			tags: Field.list(Field.text()).describe("Clear a row to remove it"),
			items: Field.list({ name: Field.text() }),
		});

		expect(
			await Markup.string(
				styled.Field({ name: "tags", class: "tags", id: "the-tags" }),
			),
		).toBe(
			'<fieldset class="tags" id="the-tags"><legend>tags</legend>' +
				'<p id="tags-description" data-description>Clear a row to remove it</p>' +
				'<div><label for="tags.0">1</label><input id="tags.0" type="text" name="tags.0"></div>' +
				"</fieldset>",
		);
		expect(
			await Markup.string(
				styled.Field({ name: "items", class: "wide", disabled: true }),
			),
		).toContain(
			// the table in an element of its own, to scroll alone
			'<fieldset class="wide" disabled><legend>items</legend><div><table>',
		);
		// a control of a row has none of them
		expect(
			await Markup.string(styled.Field({ name: "items", class: "wide" })),
		).toContain(
			'<input id="items.0.name" type="text" name="items.0.name" aria-labelledby="items.name-label">',
		);

		const Items = styled.component({ name: "items", class: "wide" });
		expect(await Markup.string(Items.Root({ id: "x" }))).toBe(
			'<fieldset class="wide" id="x"></fieldset>',
		);
	});

	test("reads many rows in one pass, and state in a URL sets no hidden value or extra row", async () => {
		const wide = new Form({
			items: Field.list({
				id: Field.hidden().optional(),
				a: Field.text().optional(),
				b: Field.text().optional(),
				c: Field.text().optional(),
			})
				.max(3)
				.optional()
				.persist(),
		});

		// one cell in each of many rows: every other cell is looked for
		const sparse = new FormData();
		for (let place = 0; place < 20000; place++)
			sparse.append(`items.${place}.a`, "x");
		const started = performance.now();
		const result = formInvalid(await wide.parse(sparse));
		expect(performance.now() - started).toBeLessThan(2000);
		expect(result.issues[0]?.message).toBe("At most 3");

		// anyone can write the state in a URL
		const forged = Codec.Base64Url.encode(
			Codec.encode(
				JSON.stringify({
					id: decodeState<typeof wide.shape>(result.search).id,
					values: {
						items: Array.from({ length: 50 }, () => ({ id: "theirs", a: "x" })),
					},
				}),
			),
		);
		const html = await Markup.string(
			wide.Field({
				name: "items",
				state: new URL(`http://localhost/?_form=${forged}`),
			}),
		);
		expect(html).not.toContain("theirs");
		expect(html.match(/<tr>/g)).toHaveLength(1 + 3);

		// the server's own values keep a row's hidden value
		expect(
			await Markup.string(
				wide.Field({ name: "items", values: { items: [{ id: "7", a: "x" }] } }),
			),
		).toContain('name="items.0.id" value="7"');
	});

	test("is an array of its items to agents", () => {
		const schema = Schema.object(form.shape).toJsonSchema({ io: "input" });

		expect(schema.properties).toEqual({
			dinners: { type: "array", items: { type: "string", format: "uuid" } },
			ingredients: {
				type: "array",
				title: "Ingredients",
				description: "What goes in",
				items: {
					type: "object",
					properties: {
						id: { type: "string" },
						amount: { type: "number" },
						name: { type: "string" },
						organic: { type: "boolean", default: false },
					},
					required: ["name"],
				},
			},
		});
		expect(schema.required).toEqual(["ingredients"]);
	});

	test("fills a GET form from its cells in the URL", async () => {
		const search = new Form({ tags: Field.list(Field.text()).optional() })[
			query
		]();

		const html = await Markup.string(
			search.Field({
				name: "tags",
				state: new URL("http://localhost/?tags.0=fall&tags.1=&tags.2=soup"),
			}),
		);
		expect(html).toContain('name="tags.0" value="fall"');
		expect(html).toContain('name="tags.1" value="soup"');
		expect(html.match(/<input/g)).toHaveLength(3);
	});

	test("shows the rows its control sets, a form's own over them, and no more than its max", async () => {
		const week = new Form({
			dinners: Field.list(Field.text())
				.max(7, "A week has seven days")
				.min(2, "Plan two dinners")
				.control({ rows: 7 })
				.optional(),
			sides: Field.list(Field.text()).control({ rows: 3 }),
			tags: Field.list(Field.text()).max(2),
		});
		const rows = async (
			props: Parameters<typeof week.Field>[0],
		): Promise<number> =>
			(await Markup.string(week.Field(props))).match(/<input/g)!.length;

		expect(await rows({ name: "dinners" })).toBe(7);
		expect(await rows({ name: "dinners", rows: 4 })).toBe(4);
		// a full list has no empty row, however many are asked for
		expect(await rows({ name: "dinners", rows: 10 })).toBe(7);
		expect(await rows({ name: "sides" })).toBe(3);
		expect(await rows({ name: "sides", rows: 5 })).toBe(5);
		expect(await rows({ name: "tags" })).toBe(1);
		expect(await rows({ name: "tags", values: { tags: ["a"] } })).toBe(2);
		expect(await rows({ name: "tags", values: { tags: ["a", "b"] } })).toBe(2);
		// every item is shown, even more than it takes
		expect(
			await rows({ name: "tags", values: { tags: ["a", "b", "c"] } }),
		).toBe(3);

		const data = new FormData();
		data.set("sides.0", "rice");
		data.set("dinners.0", "soup");
		for (const place of [0, 1, 2]) data.set(`tags.${place}`, "x");
		expect(
			formInvalid(await week.parse(data)).issues.map((issue) => [
				issue.path,
				issue.message,
			]),
		).toEqual([
			[["dinners"], "Plan two dinners"],
			[["tags"], "At most 2"],
		]);

		expect(
			Schema.object(week.shape).toJsonSchema({ io: "input" }).properties,
		).toMatchObject({
			dinners: { type: "array", minItems: 2, maxItems: 7 },
			tags: { type: "array", maxItems: 2 },
		});
	});

	test("takes as many parts as its rows, and only fields that are not lists or streamed", () => {
		// a row of each list is its fields: a thousand rows without a max()
		expect(form.parts).toBe(1000 * 1 + 1000 * 4);
		expect(
			new Form({
				week: Field.list(Field.text()).max(7),
				items: Field.list({ a: Field.text(), b: Field.text() }).max(20),
			}).parts,
		).toBe(7 + 40);

		// @ts-expect-error a list of lists
		Field.list(Field.list(Field.text()));
		// @ts-expect-error a streamed file
		Field.list({ photo: Field.file().stream() });
		// @ts-expect-error a list has no control of its own, only its rows
		Field.list(Field.text()).control({ class: "wide" });
	});
});
