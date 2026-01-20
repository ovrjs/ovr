import { type JSX, jsx } from "../jsx/index.js";
import type { StandardSchemaV1 } from "@standard-schema/spec";

export namespace Schema {
	/** Schema.parse function type */
	export type Parse<Output> = (value: unknown, path?: Schema.Path) => Output;

	/** Object schema shape. */
	export type Shape = Record<string, Schema<unknown, unknown>>;

	/** Infer the output type of a schema or shape. */
	export type Infer<T> =
		T extends Schema<infer Output, unknown>
			? Output
			: T extends Shape
				? { [K in keyof T]: Infer<T[K]> }
				: never;

	/** Internal error path representation. */
	export type Path = Array<PropertyKey>;

	/** Merge two object shapes (B overrides A on key collisions). */
	export type Merge<A extends Shape, B extends Shape> = Omit<A, keyof B> & B;

	/** Object schema with extend capability. */
	export type Object<S extends Shape> = Schema<Infer<S>, unknown> & {
		readonly shape: S;
		extend<E extends Shape>(extra: E): Object<Merge<S, E>>;
	};
}

/**
 * Minimal schema validator geared around parsing multipart `FormData`.
 *
 * Implements Standard Schema v1 via the `~standard` property (sync validate).
 */
export class Schema<Output, Input = unknown> implements StandardSchemaV1<
	Input,
	Output
> {
	/** Schema error */
	static Error = class extends Error {
		/** Best-effort location info for example `["user", "age"]` or `["tags", 0]` */
		readonly path: Schema.Path;

		/**
		 * Create a new Schema error
		 *
		 * @param message
		 * @param path
		 */
		constructor(message: string, path: Schema.Path = []) {
			super(message);
			this.name = "Schema.Error";
			this.path = path;
		}
	};

	readonly "~standard" = {
		version: 1,
		vendor: "ovr",
		validate: (value: unknown) => {
			try {
				return { value: this.parse(value) };
			} catch (e) {
				if (e instanceof Schema.Error) return { issues: [e] };
				throw e;
			}
		},
	} as const;

	/**
	 * Parse and validate an unknown value.
	 *
	 * @param value Unknown value to parse
	 * @param path Internal path reference
	 * @returns Parsed result
	 * @throws `Schema.Error` when the first encountered parse fails
	 */
	parse: Schema.Parse<Output>;

	/**
	 * Construct a new schema - used internally.
	 *
	 * Use static methods on `Schema` to make a new schema.
	 *
	 * @param parse Parse function that validates and transforms input
	 */
	constructor(parse: (value: unknown, path: Schema.Path) => Output) {
		this.parse = (value, path = []) => parse(value, path);
	}

	/** Optional schema */
	optional() {
		return new Schema<Output | undefined, Input>((v, path) => {
			if (v === undefined) return v;
			return this.parse(v, path);
		});
	}

	/**
	 * Default schema.
	 *
	 * @param value Default value to use when input is undefined
	 */
	default(value: Output) {
		return new Schema<Output, Input>((v, path) => {
			if (v === undefined) return value;
			return this.parse(v, path);
		});
	}

	/**
	 * Transform schema.
	 *
	 * Runs this schema, then transforms the parsed output value.
	 * Useful for mapping form strings into domain types for example,
	 *  trimming, parsing, or mapping empty string to null.
	 *
	 * @param fn Transform function to apply to parsed output
	 */
	transform<NextOutput>(fn: (value: Output) => NextOutput) {
		return new Schema<NextOutput, Input>((v, path) => fn(this.parse(v, path)));
	}

	/**
	 * Pipe schema.
	 *
	 * Runs this schema, then validates the result with another schema.
	 * Useful when you want to _change the type_ and then validate the new value,
	 *
	 * @param next Schema to validate the result with
	 */
	pipe<NextOutput>(next: Schema<NextOutput, unknown>) {
		return new Schema<NextOutput, Input>((v, path) =>
			next.parse(this.parse(v, path), path),
		);
	}

	/**
	 * Refine schema.
	 *
	 * Adds a custom validation rule to an existing schema.
	 * Throwing is handled: return `false` to fail with the provided message.
	 *
	 * @param check Validation function that returns false to fail
	 * @param message Error message when validation fails
	 */
	refine(check: (value: Output) => boolean, message: string) {
		return new Schema<Output, Input>((v, path) => {
			const out = this.parse(v, path);
			if (!check(out)) throw new Schema.Error(message, path);
			return out;
		});
	}

	/** String schema. */
	static string() {
		return new Schema<string, unknown>((v, path) => {
			if (typeof v !== "string") {
				throw new Schema.Error("Expected string", path);
			}

			return v;
		});
	}

	/**
	 * Boolean schema.
	 *
	 * Accepts only literal `true` or `false` booleans.
	 */
	static boolean() {
		return new Schema<boolean, unknown>((v, path) => {
			if (typeof v !== "boolean") {
				throw new Schema.Error("Expected boolean", path);
			}

			return v;
		});
	}

	/** Number schema */
	static number() {
		return new Schema<number, unknown>((v, path) => {
			if (typeof v !== "number" || Number.isNaN(v)) {
				throw new Schema.Error("Expected number", path);
			}

			return v;
		});
	}

	/** Integer schema */
	static int() {
		return Schema.number().refine(Number.isInteger, "Expected integer");
	}

	/**
	 * Date schema.
	 *
	 * Accepts only valid `Date` instances. Rejects invalid dates.
	 */
	static date() {
		return new Schema<Date, unknown>((v, path) => {
			if (
				!(v instanceof Date) ||
				// ex: new Date("nope")
				Number.isNaN(v.getTime())
			) {
				throw new Schema.Error("Expected valid date", path);
			}

			return v;
		});
	}

	/**
	 * Literal schema.
	 *
	 * @param literal Exact value to match
	 */
	static literal<const Literal>(literal: Literal) {
		return new Schema<Literal, unknown>((v, path) => {
			if (v !== literal) {
				throw new Schema.Error(`Expected ${JSON.stringify(literal)}`, path);
			}

			return literal;
		});
	}

	/**
	 * Enum schema.
	 *
	 * Validates that the input is strictly equal (`===`) to one of the allowed
	 * values.
	 *
	 * Common form usage:
	 * - `<select>` values
	 * - `<input type="radio">` values
	 *
	 * @param allowed Allowed values
	 */
	static enum<const Allowed extends readonly [unknown, ...unknown[]]>(
		allowed: Allowed,
	) {
		return new Schema<Allowed[number], unknown>((v, path) => {
			for (const a of allowed) {
				if (v === a) return a as Allowed[number];
			}

			throw new Schema.Error(
				`Expected one of: ${allowed.map((v) => JSON.stringify(v)).join(", ")}`,
				path,
			);
		});
	}

	/**
	 * Union schema.
	 *
	 * Tries each schema in order and returns the first one that successfully
	 * parses the input.
	 *
	 * @param schemas Schemas to try in order
	 */
	static union<
		const Schemas extends readonly [
			Schema<unknown, unknown>,
			...Schema<unknown, unknown>[],
		],
	>(schemas: Schemas) {
		return new Schema<Schema.Infer<Schemas[number]>, unknown>((v, path) => {
			for (const schema of schemas) {
				try {
					return schema.parse(v, path) as Schema.Infer<Schemas[number]>;
				} catch {}
			}

			throw new Schema.Error("No union variant matched", path);
		});
	}

	/**
	 * JSON schema.
	 *
	 * Parses a JSON string and then validates the parsed value with `inner`.
	 *
	 * @param inner Schema to validate the parsed JSON with
	 */
	static json<InnerOutput>(inner: Schema<InnerOutput, unknown>) {
		return new Schema<InnerOutput, unknown>((v, path) => {
			let parsed: unknown;

			try {
				parsed = JSON.parse(Schema.string().parse(v, path));
			} catch {
				throw new Schema.Error("Expected valid JSON", path);
			}

			return inner.parse(parsed, path);
		});
	}

	/**
	 * File schema.
	 *
	 * Validates that the input is a `File` instance.
	 *
	 * For optional file inputs, use `Schema.file().optional()`.
	 */
	static file() {
		return new Schema<File, unknown>((v, path) => {
			if (!(v instanceof File)) {
				throw new Schema.Error("Expected non-empty file", path);
			}

			return v;
		});
	}

	/**
	 * Array schema.
	 *
	 * Validates that the input is an array and parses each item.
	 * `undefined` is treated as an empty array.
	 *
	 * @param item Schema for each array item
	 */
	static array<ItemOutput>(item: Schema<ItemOutput, unknown>) {
		return new Schema<ItemOutput[], unknown>((v, path) => {
			if (v === undefined) return [];

			if (!(v instanceof Array)) {
				throw new Schema.Error("Expected array", path);
			}

			return Array.from(v, (value, i) => item.parse(value, [...path, i]));
		});
	}

	static #ObjectSchema = class<const Shape extends Schema.Shape> extends Schema<
		Schema.Infer<Shape>,
		unknown
	> {
		/** Object schema's shape (user input object) */
		readonly shape: Shape;

		/**
		 * @param shape Schema shape
		 * @param parse Function to parse the data into the specified shape
		 */
		constructor(
			shape: Shape,
			parse: (v: unknown, path: Schema.Path) => Schema.Infer<Shape>,
		) {
			super(parse);
			this.shape = shape;
		}

		/**
		 * Object extend schema.
		 *
		 * Returns a new object schema with `extra` merged into the current shape.
		 *
		 * @param extra Additional shape to merge
		 */
		extend<const Extra extends Schema.Shape>(
			extra: Extra,
		): Schema.Object<Schema.Merge<Shape, Extra>> {
			return Schema.object(Object.assign(this.shape, extra));
		}
	};

	/**
	 * Object schema.
	 *
	 * Validates each key in the shape and returns a new object of parsed outputs.
	 * Missing keys are passed as `undefined` so `.optional()` / `.default()` work.
	 *
	 * @param shape Object shape with schemas for each key
	 */
	static object<const Shape extends Schema.Shape>(
		shape: Shape,
	): Schema.Object<Shape> {
		return new Schema.#ObjectSchema(shape, (v, path) => {
			if (typeof v !== "object" || v === null) {
				throw new Schema.Error("Expected object", path);
			}

			const out: Record<string, unknown> = {};

			for (const key of Object.getOwnPropertyNames(v)) {
				out[key] = shape[key]!.parse(v[key as keyof typeof v], [...path, key]);
			}

			return out as Schema.Infer<Shape>;
		});
	}

	/** Coercion schemas that apply JavaScript type coercion before validation. */
	static coerce = class {
		/** Coerce to string using `String(value)`. */
		static string = () =>
			new Schema<string, unknown>((v, path) =>
				Schema.string().parse(String(v), path),
			);

		/** Coerce to number using `Number(value)`. */
		static number = () =>
			new Schema<number, unknown>((v, path) =>
				Schema.number().parse(Number(v), path),
			);

		/** Coerce to boolean using `Boolean(value)`. */
		static boolean = () => new Schema<boolean, unknown>((v) => Boolean(v));

		/** Coerce to Date using `new Date(value)`. Rejects invalid dates. */
		static date = () =>
			new Schema<Date, unknown>((v, path) =>
				Schema.date().parse(new Date(String(v)), path),
			);
	};
}

namespace Field {
	export type Read = (data: FormData, name: string) => unknown;

	export interface Options {
		/** @default "input" */
		tag: "input" | "textarea" | "select";
		label?: string;
		values?: readonly string[];
		attrs?: Record<string, unknown>;
	}
}

/** Represents a form field with parsing logic and rendering metadata. */
class Field<Output> extends Schema<Output> {
	/** Read the value from form data */
	readonly read: Field.Read;

	readonly options: Field.Options;

	constructor(
		options: Partial<Field.Options>,
		parse: Schema.Parse<Output>,
		read?: Field.Read,
	) {
		super(parse);

		this.options = { tag: "input", ...options };
		this.read =
			read ??
			// default to FormData.get
			((data, name) => {
				const v = data.get(name);
				return v == null ? undefined : v;
			});
	}

	/** Make this field optional. */
	override optional(): Field<Output | undefined> {
		return new Field(this.options, (v, path) => {
			if (v === undefined) return v;
			return this.parse(v, path);
		});
	}

	/** Provide a default value when undefined. */
	override default(value: Output): Field<Output> {
		return new Field(this.options, (v, path) => {
			if (v === undefined) return value;
			return this.parse(v, path);
		});
	}

	/**
	 * @param name Field `name` attribute
	 * @returns JSX Component that renders the HTML field
	 */
	render(name: string) {
		return jsx("div", {
			children:
				this.options.attrs?.type === "radio"
					? [
							jsx("span", { children: this.options.label ?? name }),
							this.options.values?.map((value) =>
								jsx("label", {
									children: [
										jsx(this.options.tag, {
											name,
											value,
											...this.options.attrs,
										}),
										jsx("span", { children: value }),
									],
								}),
							),
						]
					: [
							jsx("label", { for: name, children: this.options.label ?? name }),
							jsx(this.options.tag, {
								name,
								id: name,
								...this.options.attrs,
								// select options
								children: this.options.values?.map((value) =>
									jsx("option", { value, children: value }),
								),
							}),
						],
		});
	}
}

export namespace Form {
	/** Form field shape. */
	export type Shape = Record<string, Field<unknown>>;

	/** Infer the output type of a form shape. */
	export type Infer<S extends Shape> = {
		[K in keyof S]: S[K] extends Field<infer O> ? O : never;
	};

	/** Field option types. */
	export namespace Options {
		/** Field options shared by all field types. */
		export type Base = { label?: string };

		/** Input field options. */
		export type Input = Base & JSX.IntrinsicElements["input"];

		/** Textarea field options. */
		export type Textarea = Base & JSX.IntrinsicElements["textarea"];

		/** Select/radio field options. */
		export type Select = Base & JSX.IntrinsicElements["select"];
	}
}

/**
 * Form schema with JSX rendering capabilities.
 *
 * Parses `FormData` and generates form field components.
 *
 * @example
 * ```tsx
 * const User = new Form({
 *   username: Form.text({ label: "Username" }),
 *   admin: Form.checkbox(),
 *   age: Form.number(),
 * })
 *
 * // parse FormData
 * const data = User.parse(formData)
 *
 * // render fields
 * <User.Fieldset />
 * <User.Field name="username" />
 * ```
 */
export class Form<Shape extends Form.Shape> {
	/** Field definitions. */
	readonly fields: Shape;

	constructor(fields: Shape) {
		this.fields = fields;
	}

	/**
	 * Parse and validate FormData.
	 *
	 * @param data FormData to parse
	 * @param path Internal path reference
	 * @returns Parsed result
	 * @throws `Schema.Error` when the first encountered parse fails
	 */
	parse(data: FormData, path: Schema.Path = []): Form.Infer<Shape> {
		const out: Record<string, unknown> = {};

		for (const key in this.fields) {
			const schema = this.fields[key]!;

			out[key] = schema.parse(schema.read(data, key), [...path, key]);
		}

		return out as Form.Infer<Shape>;
	}

	/**
	 * Render a single form field.
	 *
	 * @example
	 *
	 * ```tsx
	 * <User.Field name="username" />
	 * ```
	 */
	Field = (
		props: {
			name: Extract<keyof Shape, string>;
		} & JSX.IntrinsicElements["input"],
	) => this.fields[props.name]!.render(props.name);

	/**
	 * Render all form fields in a fieldset.
	 *
	 * @example
	 *
	 * ```tsx
	 * <User.Fieldset />
	 * ```
	 */
	Fieldset = (props: JSX.IntrinsicElements["fieldset"] = {}) => {
		const children = [props.children];

		for (const [name, field] of Object.entries(this.fields)) {
			children.push(field.render(name));
		}

		return jsx("fieldset", { ...props, children });
	};

	/** Text input field. */
	static text(options: Form.Options.Input = {}): Field<string> {
		const { label, ...attrs } = options;

		attrs.type ??= "text";

		return new Field({ label, attrs }, Schema.string().parse);
	}

	/** Email input field. */
	static email(options: Form.Options.Input = {}): Field<string> {
		const { label, ...attrs } = options;

		attrs.type ??= "email";

		return new Field({ label, attrs }, Schema.string().parse);
	}

	/** Password input field. */
	static password(options: Form.Options.Input = {}): Field<string> {
		const { label, ...attrs } = options;

		attrs.type ??= "password";

		return new Field({ label, attrs }, Schema.string().parse);
	}

	/** URL input field. */
	static url(options: Form.Options.Input = {}): Field<string> {
		const { label, ...attrs } = options;

		attrs.type ??= "url";

		return new Field({ label, attrs }, Schema.string().parse);
	}

	/** Hidden input field. */
	static hidden(options: Form.Options.Input = {}): Field<string> {
		const { label, ...attrs } = options;

		attrs.type ??= "hidden";

		return new Field({ label, attrs }, Schema.string().parse);
	}

	/** Number input field. Coerces strings to numbers. */
	static number(options: Form.Options.Input = {}): Field<number> {
		const { label, ...attrs } = options;

		attrs.type ??= "number";

		return new Field({ label, attrs }, Schema.coerce.number().parse);
	}

	/** Date input field. Coerces strings to Dates. */
	static date(options: Form.Options.Input = {}): Field<Date> {
		const { label, ...attrs } = options;

		attrs.type ??= "date";

		return new Field({ label, attrs }, Schema.coerce.date().parse);
	}

	/**
	 * Checkbox input field.
	 *
	 * Uses presence semantics for FormData:
	 * - unchecked => key missing => false
	 * - checked => key present => true
	 */
	static checkbox(options: Form.Options.Input = {}): Field<boolean> {
		const { label, ...attrs } = options;

		attrs.type ??= "checkbox";

		return new Field(
			{ label, attrs },
			Schema.coerce.boolean().parse,
			(formData, name) => formData.has(name),
		);
	}

	/** Single file input field. */
	static file(options?: Form.Options.Input): Field<File>;
	/** Multiple file input field. */
	static file(options: Form.Options.Input & { multiple: true }): Field<File[]>;
	static file(options: Form.Options.Input = {}) {
		const { label, ...attrs } = options;

		attrs.type ??= "file";

		if (attrs.multiple) {
			return new Field<File[]>(
				{ label, attrs },
				Schema.array(Schema.file()).parse,
				(data, name) => data.getAll(name),
			);
		}

		return new Field<File>(
			{ label, attrs },
			Schema.file().parse,
			(data, name) => data.get(name),
		);
	}

	/** Radio button group field. */
	static radio<const T extends string>(
		values: readonly [T, ...T[]],
		options: Form.Options.Input = {},
	): Field<T> {
		const { label, ...attrs } = options;

		attrs.type ??= "radio";

		return new Field({ label, values, attrs }, Schema.enum(values).parse);
	}

	/** Textarea field. */
	static textarea(options: Form.Options.Textarea = {}): Field<string> {
		const { label, ...attrs } = options;

		attrs.type ??= "textarea";

		return new Field({ tag: "textarea", label, attrs }, Schema.string().parse);
	}

	/** Select dropdown field. */
	static select<const T extends string>(
		values: readonly [T, ...T[]],
		options: Form.Options.Select = {},
	): Field<T> {
		const { label, ...attrs } = options;

		return new Field(
			{ tag: "select", label, values, attrs },
			Schema.enum(values).parse,
		);
	}
}
