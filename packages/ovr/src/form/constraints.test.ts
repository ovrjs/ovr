import { Render } from "../render/index.js";
import { Schema } from "../schema/index.js";
import { Field, Form } from "./index.js";
import { describe, expect, test } from "vitest";

/**
 * @param field Field to render
 * @returns Its control's tag, as the form writes it
 */
const control = async (field: Field.Any) => {
	const form = new Form({ value: field });
	const html = await new Render({
		markup: form.Field({ name: "value" }),
	}).string();

	return /<(?:input|textarea)[^>]*>/.exec(html)![0];
};

/**
 * @param field Field to send a value to
 * @param value Value sent, as a form's entry
 * @returns The first issue's message, `undefined` when the value is taken
 */
const refused = async (field: Field.Any, value: string | File) => {
	const data = new FormData();
	data.set("value", value);
	const result = await new Form({ value: field }).parse(data);

	return result.issues?.[0].message;
};

/** @returns The field as a tool's argument is described to an agent */
const described = (field: Field.Any) =>
	(
		Schema.object({ value: field }).toJsonSchema({
			io: "input",
			unrepresentable: "any",
		}) as { properties: { value: Record<string, unknown> } }
	).properties.value;

describe("a length", () => {
	test("is the control's, so the browser checks it too", async () => {
		expect(await control(Field.text().min(2).max(200))).toBe(
			'<input id="value" required minlength="2" maxlength="200" type="text" name="value">',
		);
		expect(await control(Field.textarea().max(500).optional())).toContain(
			'maxlength="500"',
		);
		for (const field of [
			Field.search(),
			Field.tel(),
			Field.email(),
			Field.url(),
			Field.password(),
		])
			expect(await control(field.max(80))).toContain('maxlength="80"');
	});

	test("of one is what required already asks for", async () => {
		expect(await control(Field.text().min(1))).toBe(
			'<input id="value" required type="text" name="value">',
		);
	});

	test("is the strictest of the ones given, in whole characters", async () => {
		const tag = await control(Field.text().min(2).min(3.2).max(50).max(40.9));

		expect(tag).toContain('minlength="4"');
		expect(tag).toContain('maxlength="40"');
	});

	test("of each line, or of a changed value, is the server's alone", async () => {
		// a textarea's own length would count every line together
		expect(await control(Field.textarea().max(80).lines())).not.toContain(
			"maxlength",
		);
		// checked after the value is changed, so it is not the control's
		expect(
			await control(
				Field.text()
					.transform((value) => value.trim())
					.max(10),
			),
		).not.toContain("maxlength");
		expect(await control(Field.hidden().max(10))).not.toContain("maxlength");
	});

	test("what control() sets is kept", async () => {
		expect(
			await control(Field.text().max(40).control({ maxlength: 20 })),
		).toContain('maxlength="20"');
	});
});

describe("a number", () => {
	test("has its range, and takes decimals unless it is an integer", async () => {
		expect(await control(Field.number().min(0.5).max(5))).toBe(
			'<input id="value" required min="0.5" max="5" step="any" type="number" name="value">',
		);
		// a whole number is what a number input takes by default
		expect(await control(Field.number().int().min(1))).toBe(
			'<input id="value" required min="1" type="number" name="value">',
		);
		expect(await control(Field.range().max(10))).toContain(
			'max="10" step="any" type="range"',
		);
	});

	test("keeps the strictest range, and a step control() sets", async () => {
		const tag = await control(
			Field.number().min(1).min(3).max(9).max(7).control({ step: 0.5 }),
		);

		expect(tag).toContain('min="3" max="7"');
		expect(tag).toContain('step="0.5"');
		expect(tag).not.toContain('step="any"');
	});
});

describe("a picker's range", () => {
	test("is the control's, and the server's", async () => {
		const day = Field.date().min("2026-01-01").max("2026-12-31");

		expect(await control(day)).toBe(
			'<input id="value" required min="2026-01-01" max="2026-12-31" type="date" name="value">',
		);
		expect(await refused(day, "2026-06-15")).toBeUndefined();
		expect(await refused(day, "2026-01-01")).toBeUndefined();
		expect(await refused(day, "2025-12-31")).toBe("2026-01-01 or later");
		expect(await refused(day, "2027-01-01")).toBe("2026-12-31 or earlier");
		expect(
			await refused(Field.date().min("2026-01-01", "Too early"), "2020-01-01"),
		).toBe("Too early");
	});

	test("is each picker's own", async () => {
		const pickers = [
			[
				Field.datetime().min("2026-01-01T09:00"),
				"2026-01-01T08:59",
				"2026-01-01T09:00:30",
			],
			[Field.month().min("2026-03"), "2026-02", "2026-03"],
			[Field.week().min("2026-W10"), "2026-W09", "2026-W10"],
			[Field.time().min("09:00"), "08:59", "09:00:01"],
		] as const;

		for (const [field, early, fine] of pickers) {
			expect(await control(field)).toMatch(/ min="[^"]+" type="/);
			expect(await refused(field, early)).toMatch(/or later$/);
			expect(await refused(field, fine)).toBeUndefined();
		}
		expect(await refused(Field.time().max("17:00"), "17:01")).toBe(
			"17:00 or earlier",
		);
	});

	test("is told to agents, and the strictest is kept", () => {
		const day = Field.date()
			.describe("When it was cooked")
			.min("2020-01-01")
			.min("2026-01-01")
			.max("2026-12-31");

		expect(described(day)).toMatchObject({
			description:
				"When it was cooked. Date as YYYY-MM-DD. No earlier than 2026-01-01. No later than 2026-12-31.",
		});
	});

	test("is written as the picker writes a value", () => {
		if (false) {
			// @ts-expect-error not a date
			Field.date().min("tomorrow");
			// @ts-expect-error a time's is HH:mm
			Field.time().max("2026-01-01");
			// @ts-expect-error text has a length, not an earliest value
			Field.text().min("2026-01-01");
		}

		expect(Field.date().min("2026-01-01")).toBeInstanceOf(Schema);
	});
});

describe("pattern", () => {
	const username = Field.text()
		.describe("3 to 30 lowercase letters, numbers, or _")
		.pattern("[a-z0-9_]{3,30}");

	test("is the control's, with what people read as its title", async () => {
		expect(await control(username)).toBe(
			'<input id="value" required toolparamdescription="3 to 30 lowercase letters, numbers, or _" aria-describedby="value-description" pattern="[a-z0-9_]{3,30}" title="3 to 30 lowercase letters, numbers, or _" type="text" name="value">',
		);
		// the hint, where it is what people read in place of the description
		expect(
			await control(
				Field.text()
					.describe("For an agent, at length")
					.hint("Lowercase letters")
					.pattern("[a-z]+"),
			),
		).toContain('pattern="[a-z]+" title="Lowercase letters"');
		// chained in any order
		expect(
			await control(Field.text().pattern("[a-z]+").hint("Lowercase letters")),
		).toContain('title="Lowercase letters"');
		// nothing to say, so the browser's own words stand alone
		expect(await control(Field.text().pattern("[a-z]+"))).toBe(
			'<input id="value" required pattern="[a-z]+" type="text" name="value">',
		);
		expect(
			await control(
				Field.text().describe("For an agent").hint("").pattern("[a-z]+"),
			),
		).not.toContain("title");
	});

	test("is matched by the whole value on the server, as a browser does", async () => {
		expect(await refused(username, "ross_r")).toBeUndefined();
		expect(await refused(username, "Ross")).toBe(
			"Expected pattern [a-z0-9_]{3,30}",
		);
		// a part that matches is not enough
		expect(await refused(username, "ross r")).toBe(
			"Expected pattern [a-z0-9_]{3,30}",
		);
		expect(await refused(Field.text().pattern("a|b", "a or b"), "ab")).toBe(
			"a or b",
		);
	});

	test("is told to agents, anchored as JSON Schema reads it", () => {
		expect(described(username)).toMatchObject({
			type: "string",
			description: "3 to 30 lowercase letters, numbers, or _",
			pattern: "^(?:[a-z0-9_]{3,30})$",
		});
	});

	test("checks a textarea and a plain schema, which have no control for it", async () => {
		const notes = Field.textarea().pattern("[^<>]*", "No angle brackets");

		expect(await control(notes)).not.toContain("pattern");
		expect(await refused(notes, "a <b>")).toBe("No angle brackets");
		expect(Schema.string().pattern("\\d+").parse("12a").issues).toBeDefined();
		expect(Schema.string().pattern("\\d+").parse("12").data).toBe("12");
	});

	test("that is not an expression fails where it is written", () => {
		expect(() => Field.text().pattern("[a-")).toThrow(SyntaxError);
	});
});

describe("accept", () => {
	const photo = Field.file().accept(["image/jpeg", "image/png", "image/webp"]);
	const file = (name: string, type: string) => new File(["x"], name, { type });

	test("is the picker's", async () => {
		expect(await control(photo)).toBe(
			'<input id="value" required type="file" accept="image/jpeg,image/png,image/webp" name="value">',
		);
		expect(await control(photo.multiple())).toContain(
			'accept="image/jpeg,image/png,image/webp"',
		);
	});

	test("refuses any other type on the server, also one not given", async () => {
		const message =
			"Expected a file of type image/jpeg, image/png, or image/webp";

		expect(await refused(photo, file("a.jpg", "image/jpeg"))).toBeUndefined();
		expect(await refused(photo, file("a.png", "IMAGE/PNG"))).toBeUndefined();
		expect(await refused(photo, file("a.svg", "image/svg+xml"))).toBe(message);
		expect(await refused(photo, file("a.html", "text/html"))).toBe(message);
		// a file that does not say its type is not taken for its name
		expect(await refused(photo, file("a.jpg", ""))).toBe(message);
	});

	test("takes any of a kind, and a message of its own", async () => {
		const image = Field.file().accept(
			["image/*", "application/pdf"],
			"A photo or a PDF",
		);

		expect(await refused(image, file("a.gif", "image/gif"))).toBeUndefined();
		expect(
			await refused(image, file("a.pdf", "application/pdf")),
		).toBeUndefined();
		expect(await refused(image, file("a.txt", "text/plain"))).toBe(
			"A photo or a PDF",
		);
		expect(await refused(image, file("a", "imagery/x"))).toBe(
			"A photo or a PDF",
		);
	});

	test("checks each of many files", async () => {
		const data = new FormData();
		data.append("value", file("a.jpg", "image/jpeg"));
		data.append("value", file("a.svg", "image/svg+xml"));
		const result = await new Form({ value: photo.multiple() }).parse(data);

		expect(result.issues?.[0].path).toEqual(["value", 1]);
	});

	test("is told to agents", () => {
		expect(described(photo.describe("How it turned out"))).toMatchObject({
			description:
				"How it turned out. Accepts image/jpeg, image/png, or image/webp.",
		});
	});

	test("and pattern are the schema's, not control()'s", () => {
		if (false) {
			// @ts-expect-error accept() is also checked on the server
			Field.file().control({ accept: "image/*" });
			// @ts-expect-error pattern() is also checked on the server
			Field.text().control({ pattern: "[a-z]+" });
			// @ts-expect-error a media type, not an extension
			Field.file().accept([".jpg"]);
			// @ts-expect-error only a file field takes types
			Field.text().accept(["image/png"]);
		}

		expect(photo).toBeInstanceOf(Schema);
	});
});
