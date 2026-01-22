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

	export type Derived<From, Output> =
		From extends Field<unknown>
			? Field<Output>
			: From extends Schema<unknown, infer Input>
				? Schema<Output, Input>
				: never;
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
	// https://colinhacks.com/essays/reasonable-email-regex
	static #emailRegex =
		/^(?!\.)(?!.*\.\.)([a-z0-9_'+\-\.]*)[a-z0-9_'+\-]@([a-z0-9][a-z0-9\-]*\.)+[a-z]{2,}$/i;

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

	/** Create a new schema */
	create<NextOutput>(parse: Schema.Parse<NextOutput>) {
		return new Schema<NextOutput, Input>(parse);
	}

	/** Optional schema */
	optional(this: Field<Output>): Field<Output | undefined>;
	optional(this: Schema<Output, Input>): Schema<Output | undefined, Input>;
	optional(this: Schema<Output, Input>) {
		return this.create((v, path) => {
			if (v === undefined) return v;
			return this.parse(v, path);
		});
	}

	/**
	 * Default schema.
	 *
	 * @param value Default value to use when input is undefined
	 */
	default(this: Field<Output>, value: Output): Field<Output>;
	default(this: Schema<Output, Input>, value: Output): Schema<Output, Input>;
	default(this: Schema<Output, Input>, value: Output) {
		return this.create((v, path) => {
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
	transform<NextOutput>(
		this: Field<Output>,
		fn: (value: Output) => NextOutput,
	): Field<NextOutput>;
	transform<NextOutput>(
		this: Schema<Output, Input>,
		fn: (value: Output) => NextOutput,
	): Schema<NextOutput, Input>;
	transform<NextOutput>(
		this: Schema<Output, Input>,
		fn: (value: Output) => NextOutput,
	) {
		return this.create((v, path) => fn(this.parse(v, path)));
	}

	/**
	 * Pipe schema.
	 *
	 * Runs this schema, then validates the result with another schema.
	 * Useful when you want to _change the type_ and then validate the new value,
	 *
	 * @param next Schema to validate the result with
	 */
	pipe<NextOutput>(
		this: Field<Output>,
		next: Schema<NextOutput, unknown>,
	): Field<NextOutput>;
	pipe<NextOutput>(
		this: Schema<Output, Input>,
		next: Schema<NextOutput, unknown>,
	): Schema<NextOutput, Input>;
	pipe<NextOutput>(
		this: Schema<Output, Input>,
		next: Schema<NextOutput, unknown>,
	) {
		return this.create((v, path) => next.parse(this.parse(v, path), path));
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
	refine(
		this: Field<Output>,
		check: (value: Output) => boolean,
		message: string,
	): Field<Output>;
	refine(
		this: Schema<Output, Input>,
		check: (value: Output) => boolean,
		message: string,
	): Schema<Output, Input>;
	refine(
		this: Schema<Output, Input>,
		check: (value: Output) => boolean,
		message: string,
	) {
		return this.create((v, path) => {
			const out = this.parse(v, path);
			if (!check(out)) throw new Schema.Error(message, path);
			return out;
		});
	}

	/** String schema. */
	static string() {
		return new Schema((v, path) => {
			if (typeof v !== "string") {
				throw new Schema.Error("Expected string", path);
			}

			return v;
		});
	}

	/**
	 * Validate an input is a valid email string.
	 *
	 * @returns Email schema
	 */
	static email() {
		return Schema.string().refine(Schema.#emailRegex.test, "Expected email");
	}

	/**
	 * Validate an input is a valid URL string.
	 *
	 * @returns URL schema
	 */
	static url() {
		return Schema.string().refine(URL.canParse, "Expected URL");
	}

	/**
	 * Boolean schema.
	 *
	 * Accepts only literal `true` or `false` booleans.
	 */
	static boolean() {
		return new Schema((v, path) => {
			if (typeof v !== "boolean") {
				throw new Schema.Error("Expected boolean", path);
			}

			return v;
		});
	}

	/** Number schema */
	static number() {
		return new Schema((v, path) => {
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
		return new Schema((v, path) => {
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
		return new Schema((v, path) => {
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
		return new Schema((v, path) => {
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
		return new Schema((v, path) => {
			for (const schema of schemas) {
				try {
					return schema.parse(v, path) as Schema.Infer<Schemas[number]>;
				} catch (e) {
					if (!(e instanceof Schema.Error)) throw e;
				}
			}

			throw new Schema.Error("Expected union variant", path);
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
		return new Schema((v, path) => {
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
		return new Schema((v, path) => {
			if (!(v instanceof File)) {
				throw new Schema.Error("Expected file", path);
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
		return new Schema((v, path) => {
			if (v === undefined) return [];

			if (!Array.isArray(v)) {
				throw new Schema.Error("Expected array", path);
			}

			return Array.from(v, (value, i) => item.parse(value, [...path, i]));
		});
	}

	/** Coercion schemas that apply JavaScript type coercion before validation. */
	static coerce = class {
		/** Coerce to string using `String(value)`. */
		static string() {
			return new Schema((v, path) => Schema.string().parse(String(v), path));
		}

		/** Coerce to number using `Number(value)`. */
		static number() {
			return new Schema((v, path) => Schema.number().parse(Number(v), path));
		}

		/** Coerce to boolean using `Boolean(value)`. */
		static boolean() {
			return new Schema((v) => Boolean(v));
		}

		/** Coerce to Date using `new Date(value)`. Rejects invalid dates. */
		static date() {
			return new Schema((v, path) =>
				Schema.date().parse(new Date(String(v)), path),
			);
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
	static object<const Shape extends Schema.Shape>(shape: Shape) {
		return new Obj(shape);
	}
}

class Obj<const Shape extends Schema.Shape> extends Schema<
	Schema.Infer<Shape>,
	unknown
> {
	/** Object schema's shape (user input object) */
	readonly shape: Shape;

	/**
	 * Create a new object schema.
	 *
	 * @param shape Schema shape
	 */
	constructor(shape: Shape) {
		super((v, path) => {
			if (typeof v !== "object" || v === null || Array.isArray(v)) {
				throw new Schema.Error("Expected object", path);
			}

			const out: Record<string, unknown> = {};

			for (const [key, schema] of Object.entries(shape)) {
				out[key] = schema.parse((v as Record<string, unknown>)[key], [
					...path,
					key,
				]);
			}

			return out as Schema.Infer<Shape>;
		});

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
	): // return type required
	Schema.Object<Schema.Merge<Shape, Extra>> {
		return Schema.object({ ...this.shape, ...extra });
	}
}

export namespace Field {
	export type Read = (data: FormData, name: string) => unknown;

	export interface Options extends Form.Options {
		/**
		 * Tag name.
		 *
		 * @default "input"
		 */
		tag?: "input" | "textarea" | "select";

		/** Input `type` attribute value */
		type?: JSX.IntrinsicElements["input"]["type"];

		/** Values are used for `input[type=radio]`, and `select` elements */
		values?: readonly string[];

		/** Used for multiple file inputs */
		multiple?: boolean;
	}

	export type Props<Shape> = { name: Extract<keyof Shape, string> } & (
		| JSX.IntrinsicElements["input"]
		| JSX.IntrinsicElements["textarea"]
		| JSX.IntrinsicElements["select"]
	);
}

/** Represents a form field with parsing logic and rendering metadata. */
export class Field<Output> extends Schema<Output> {
	/** Read the value from form data */
	readonly read: Field.Read;

	readonly options: Field.Options;

	constructor(
		options: Field.Options,
		parse: Schema.Parse<Output>,
		read?: Field.Read,
	) {
		super(parse);

		this.options = options;

		this.read =
			read ??
			// default to FormData.get
			((data, name) => {
				const v = data.get(name);
				return v == null ? undefined : v;
			});
	}

	override create<NextOutput>(parse: Schema.Parse<NextOutput>) {
		return new Field<NextOutput>(this.options, parse, this.read);
	}

	/**
	 * @param props Field props including `name`
	 * @returns JSX Component that renders the HTML field
	 */
	render<Shape extends Form.Shape>(props: Field.Props<Shape>) {
		const id = props.id ?? props.name;
		const { tag = "input", label = id, type, values, multiple } = this.options;

		return jsx("div", {
			children:
				type === "radio"
					? [
							jsx("span", { children: label }),
							values?.map((value) =>
								jsx("label", {
									children: [
										jsx(tag, { value, type, ...props }),
										jsx("span", { children: value }),
									],
								}),
							),
						]
					: [
							jsx("label", { for: id, children: label }),
							jsx(tag, {
								id,
								type,
								multiple,
								...props,
								// <select> options
								children: values?.map((value) =>
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
	export interface Options {
		label?: string;
	}
}

/**
 * Form schema with JSX rendering capabilities.
 *
 * Parses `FormData` and generates form field components.
 *
 * @example
 * ```tsx
 * const User = Schema.form({
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

	/**
	 * Create a new form schema validator.
	 *
	 * @param fields Form fields
	 */
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
	parse(data: FormData, path: Schema.Path = []) {
		const out: Record<string, unknown> = {};

		for (const [key, schema] of Object.entries(this.fields)) {
			out[key] = schema.parse(schema.read(data, key), [...path, key]);
		}

		return out as Form.Infer<Shape>;
	}

	/**
	 * Render a single form field.
	 *
	 * @param props Component props
	 * @example
	 *
	 * ```tsx
	 * <User.Field name="username" />
	 * ```
	 */
	Field = (props: Field.Props<Shape>) => this.fields[props.name]!.render(props);

	/**
	 * Render all form fields in a fieldset.
	 *
	 * @param props Component props
	 * @example
	 *
	 * ```tsx
	 * <User.Fieldset />
	 * ```
	 */
	Fieldset = (props: JSX.IntrinsicElements["fieldset"] = {}) => {
		const children = [props.children];

		for (const [name, field] of Object.entries(this.fields)) {
			children.push(field.render({ name }));
		}

		return jsx("fieldset", { ...props, children });
	};

	/** Generic input field */
	static #input(
		type: JSX.IntrinsicElements["input"]["type"],
		options: Form.Options = {},
	) {
		return new Field({ type, ...options }, Schema.string().parse);
	}

	/** Text input field. */
	static text(options: Form.Options = {}) {
		return this.#input("text", options);
	}

	/** Password input field. */
	static password(options: Form.Options = {}) {
		return this.#input("password", options);
	}

	/** Hidden input field. */
	static hidden(options: Form.Options = {}) {
		return this.#input("hidden", options);
	}

	/** Email input field. */
	static email(options: Form.Options = {}) {
		return new Field({ type: "email", ...options }, Schema.email().parse);
	}

	/** URL input field. */
	static url(options: Form.Options = {}) {
		return new Field({ type: "url", ...options }, Schema.url().parse);
	}

	/** Number input field. Coerces strings to numbers. */
	static number(options: Form.Options = {}) {
		return new Field(
			{ type: "number", ...options },
			Schema.coerce.number().parse,
		);
	}

	/** Range input field. Coerces strings to numbers. */
	static range(options: Form.Options = {}) {
		return new Field(
			{ type: "range", ...options },
			Schema.coerce.number().parse,
		);
	}

	/** Date input field. Coerces strings to Dates. */
	static date(options: Form.Options = {}) {
		return new Field({ type: "date", ...options }, Schema.coerce.date().parse);
	}

	/**
	 * Checkbox input field.
	 *
	 * Uses presence semantics for FormData:
	 * - unchecked => key missing => false
	 * - checked => key present => true
	 */
	static checkbox(options: Form.Options = {}) {
		return new Field(
			{ type: "checkbox", ...options },
			Schema.coerce.boolean().parse,
			(formData, name) => formData.has(name),
		);
	}

	/** Single file input field. */
	static file(options?: Field.Options): Field<File>;
	/** Multiple file input field. */
	static file(options: Form.Options & { multiple: true }): Field<File[]>;
	static file(options: Form.Options & { multiple?: boolean } = {}) {
		let parse: Schema.Parse<File | File[]>;
		let read: Field.Read;

		if (options.multiple) {
			parse = Schema.array(Schema.file()).parse;
			read = (data, name) => data.getAll(name);
		} else {
			parse = Schema.file().parse;
			read = (data, name) => data.get(name);
		}

		return new Field({ type: "file", ...options }, parse, read);
	}

	/** Radio button group field. */
	static radio<const T extends string>(
		values: readonly [T, ...T[]],
		options: Form.Options = {},
	) {
		return new Field(
			{ type: "radio", values, ...options },
			Schema.enum(values).parse,
		);
	}

	/** Textarea field. */
	static textarea(options: Form.Options = {}) {
		return new Field({ tag: "textarea", ...options }, Schema.string().parse);
	}

	/** Select dropdown field. */
	static select<const T extends string>(
		values: readonly [T, ...T[]],
		options: Form.Options = {},
	) {
		return new Field(
			{ tag: "select", values, ...options },
			Schema.enum(values).parse,
		);
	}
}
