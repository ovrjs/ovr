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
	test("parses mixed field types and leaves date strings unvalidated", async () => {
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
		// a group's after its options, and nothing for a hidden field or without one
		expect(await Markup.string(form.Field({ name: "size" }))).toMatch(
			/<\/div><p id="size-description" data-description>Pick one<\/p><\/fieldset>$/,
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

describe("lines", () => {
	const form = new Form({
		steps: Field.lines(),
		tags: Field.lines().optional(),
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
		expect(ingredients).toBe(
			"<fieldset><legend>Ingredients</legend>" +
				"<div>" +
				'<input type="hidden" name="ingredients.0.id" value="7">' +
				'<div><label for="ingredients.0.amount">amount</label><input id="ingredients.0.amount" type="number" name="ingredients.0.amount" value="2"></div>' +
				'<div><label for="ingredients.0.name">name</label><input id="ingredients.0.name" type="text" name="ingredients.0.name" value="onion"></div>' +
				'<div><label for="ingredients.0.organic">organic</label><input id="ingredients.0.organic" type="checkbox" name="ingredients.0.organic" checked></div>' +
				"</div>" +
				"<div>" +
				'<input type="hidden" name="ingredients.1.id">' +
				'<div><label for="ingredients.1.amount">amount</label><input id="ingredients.1.amount" type="number" name="ingredients.1.amount"></div>' +
				'<div><label for="ingredients.1.name">name</label><input id="ingredients.1.name" type="text" name="ingredients.1.name"></div>' +
				'<div><label for="ingredients.1.organic">organic</label><input id="ingredients.1.organic" type="checkbox" name="ingredients.1.organic"></div>' +
				"</div>" +
				'<p id="ingredients-description" data-description>What goes in</p>' +
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
		expect(html).toContain('name="ingredients.0.name" value="onion"');
		expect(html).toContain(
			'<input id="ingredients.1.name" autofocus aria-invalid="true" aria-describedby="ingredients.1.name-issue" type="text" name="ingredients.1.name"><p id="ingredients.1.name-issue" data-issue="0">Required field</p>',
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

	test("takes any number of parts, and only fields that are not lists or streamed", () => {
		expect(form.parts).toBe(Infinity);

		// @ts-expect-error a list of lists
		Field.list(Field.list(Field.text()));
		// @ts-expect-error a streamed file
		Field.list({ photo: Field.file().stream() });
		// @ts-expect-error a list has no control of its own
		Field.list(Field.text()).control({ class: "wide" });
	});
});
