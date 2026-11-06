import { Multipart } from "../multipart/index.js";
import { Render } from "../render/index.js";
import type { Schema } from "../schema/index.js";
import { Codec } from "../util/index.js";
import { Field, Form } from "./index.js";
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
		Codec.decode(Codec.Base64Url.decode(search[0][1])),
	) as Form.State<S>;
};

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

		const result = formValid(await form.parse(data)).data satisfies {
			age?: number;
			count: number;
		};

		expect(result).toEqual({ count: 5 });
	});

	test("empty file inputs are treated as missing during form parsing", async () => {
		const form = Form.from({
			license: Field.file().optional(),
			uploads: Field.files().optional(),
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
		const form = Form.from({ license: Field.file() });
		const data = new FormData();
		const file = new File([""], "license.pdf", { type: "application/pdf" });

		data.set("license", file);

		expect(valid(await form.parse(data))).toEqual({ license: file });
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
			"Select an option",
			"Select an option",
			"Required field",
		]);
	});

	test("missing multi-value fields respect optional and default", async () => {
		const form = Form.from({
			roles: Field.checkboxes(["reader", "admin"]).optional(),
			tags: Field.multiselect(["a", "b", "c"]).default(["a"]),
			uploads: Field.files().optional(),
		});

		expect(valid(await form.parse(new FormData()))).toEqual({ tags: ["a"] });
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

		expect(valid(await form.parse(params))).toEqual({ time: "09:00" });
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
			search: "fallback",
			tel: "555-0100",
			color: "#000000",
			hidden: "token",
			url: "https://example.com",
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
			url: "https://example.com",
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

	test("required single-value non-text fields use the required message, choices ask to select", async () => {
		const form = Form.from({
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
		const form = Form.from({
			role: Field.radio(["reader", "admin"]),
			sort: Field.select(["relevance", "newest"]),
			roles: Field.checkboxes(["reader", "admin"]),
			tags: Field.multiselect(["a", "b"]),
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
		const form = Form.from({
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

		expect(result.search?.[0]?.[0]).toBe("_form");
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

		expect(result.search?.[0]?.[0]).toBe("_form");
		expect(state.values?.name).toBe("x");
		expect(state.values?.role).toBe("owner");
		expect(state.values?.password).toBeUndefined();
		expect(state.id).toBeTruthy();
		expect(state.issues?.length).toBeGreaterThan(0);
	});

	test("blank opted-in text values are kept empty in invalid state, overriding initial values", async () => {
		const form = Form.from({
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
		const form = Form.from({
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
		const form = Form.from({
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

		const html = await Render.string(form.Field({ name: "name", state: url }));

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

		url.searchParams.set("_form", result.search![0][1]);

		const name = await Render.string(form.Field({ name: "name", state: url }));
		const email = await Render.string(
			form.Field({ name: "email", state: url }),
		);

		expect(name.includes('value="ross"')).toBe(true);
		expect(email.includes('value="ross@example.com"')).toBe(false);
	});

	test("render state autofocuses only the first invalid field", async () => {
		const form = Form.from({
			first: Field.text().min(2),
			second: Field.text().min(2),
		});
		const data = new FormData();

		data.set("first", "x");
		data.set("second", "y");

		const result = formInvalid(await form.parse(data));
		const url = new URL("https://example.com/form");

		url.searchParams.set("_form", result.search![0][1]);

		const html = await Render.string(form.Fields({ state: url }));
		const autofocus = html.match(/autofocus/g) ?? [];

		expect(autofocus).toHaveLength(1);
		expect(html.includes('<input id="first" autofocus')).toBe(true);
		expect(html.includes('<input id="second" autofocus')).toBe(false);
	});

	test("render state without issues does not autofocus the first field", async () => {
		const form = Form.from({ first: Field.text(), second: Field.text() });
		const url = new URL("https://example.com/form");

		url.searchParams.set("first", "ross");

		const html = await Render.string(form.Fields({ state: url }));
		const autofocus = html.match(/autofocus/g) ?? [];

		expect(autofocus).toHaveLength(0);
	});

	test("field label metadata renders text without leaking to controls", async () => {
		const form = Form.from({
			email: Field.email({ label: "Email Address" }),
			role: Field.radio(["reader", "admin"], { label: "Role" }),
		});

		const email = await Render.string(form.Field({ name: "email" }));
		const role = await Render.string(form.Field({ name: "role" }));

		expect(email.includes(">Email Address</label>")).toBe(true);
		expect(email.includes(' label="Email Address"')).toBe(false);
		expect(role.includes("<legend>Role</legend>")).toBe(true);
		expect(role.includes(' label="Role"')).toBe(false);
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

		const q = await Render.string(form.Field({ name: "q", state: url }));
		const sort = await Render.string(form.Field({ name: "sort", state: url }));
		const inStock = await Render.string(
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
		url.searchParams.set("_form", result.search![0][1]);

		const q = await Render.string(form.Field({ name: "q", state: url }));
		const sort = await Render.string(form.Field({ name: "sort", state: url }));

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

		const name = await Render.string(form.Field({ name: "name", state: url }));
		const email = await Render.string(
			form.Field({ name: "email", state: url }),
		);
		const password = await Render.string(
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

		const html = await Render.string(form.Field({ name: "name", state: url }));

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

	test("names of inherited properties are unexpected fields too", async () => {
		const form = Form.from({ name: Field.text() });
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
