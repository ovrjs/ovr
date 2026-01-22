import { type JSX, jsx } from "../jsx/index.js";
import type { StandardSchemaV1 } from "@standard-schema/spec";

export namespace Schema {
	/**
	 * Schema.parse function type
	 *
	 * @template O Parse output
	 */
	export type Parse<O> = (value: unknown, path?: Schema.Path) => O;

	/** Object schema shape. */
	export type Shape = Record<string, Schema<unknown, unknown>>;

	/**
	 * Infer Output type of a schema or shape.
	 *
	 * @template S Schema or shape type to infer from
	 */
	export type Infer<S> =
		S extends Schema<infer Output, unknown>
			? Output
			: S extends Shape
				? { [K in keyof S]: Infer<S[K]> }
				: never;

	/** Internal error path representation. */
	export type Path = Array<PropertyKey>;

	/**
	 * Merge two object shapes (B overrides A on key collisions).
	 *
	 * @template A First shape type
	 * @template B Second shape type
	 */
	export type Merge<A extends Shape, B extends Shape> = Omit<A, keyof B> & B;

	/**
	 * Object schema with extend capability.
	 *
	 * @template S Shape type
	 */
	export type Object<S extends Shape> = Schema<Infer<S>, unknown> & {
		readonly shape: S;
		extend<E extends Shape>(extra: E): Object<Merge<S, E>>;
	};

	export namespace Form {
		export type Instance<Shape extends Form.Shape> = InstanceType<
			typeof Form<Shape>
		>;
		/** Form field shape. */
		export type Shape = Record<string, Field<unknown>>;

		/**
		 * Infer Output type of a form shape.
		 *
		 * @template S Shape type
		 */
		export type Infer<S extends Shape> = {
			[K in keyof S]: S[K] extends Field<infer O> ? O : never;
		};
	}
}

/**
 * Minimal schema validator geared around parsing multipart `FormData`.
 *
 * Implements Standard Schema v1 via the `~standard` property (sync validate).
 *
 * @template Output Output type after parsing
 * @template Input Input type expected (defaults to unknown)
 */
export class Schema<Output, Input = unknown> implements StandardSchemaV1<
	Input,
	Output
> {
	/** [Reasonable Email Regex by Colin McDonnell](https://colinhacks.com/essays/reasonable-email-regex) */
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

	/**
	 * Derive a new schema from the current.
	 *
	 * @template O Output type of the new schema
	 * @param parse Parse function that validates and transforms input
	 * @returns New schema instance
	 */
	derive<O>(parse: Schema.Parse<O>) {
		return new Schema<O, Input>(parse);
	}

	/**
	 * @returns Optional field
	 */
	optional(this: Field<Output>): Field<Output | undefined>;
	/**
	 * @returns Optional schema
	 */
	optional(this: Schema<Output, Input>): Schema<Output | undefined, Input>;
	optional(this: Schema<Output, Input>) {
		return this.derive((v, path) => {
			if (v === undefined) return v;
			return this.parse(v, path);
		});
	}

	/**
	 * @param value Default value to use when input is undefined
	 * @returns Field with default
	 */
	default(this: Field<Output>, value: Output): Field<Output>;
	/**
	 * @param value Default value to use when input is undefined
	 * @returns Schema with default
	 */
	default(this: Schema<Output, Input>, value: Output): Schema<Output, Input>;
	default(this: Schema<Output, Input>, value: Output) {
		return this.derive((v, path) => {
			if (v === undefined) return value;
			return this.parse(v, path);
		});
	}

	/**
	 * @template O Output type after transformation
	 * @param fn Transform function to apply to parsed output
	 * @returns Transformed field
	 */
	transform<O>(this: Field<Output>, fn: (value: Output) => O): Field<O>;
	/**
	 * @template O Output type after transformation
	 * @param fn Transform function to apply to parsed output
	 * @returns Transformed schema
	 */
	transform<O>(
		this: Schema<Output, Input>,
		fn: (value: Output) => O,
	): Schema<O, Input>;
	transform<O>(this: Schema<Output, Input>, fn: (value: Output) => O) {
		return this.derive((v, path) => fn(this.parse(v, path)));
	}

	/**
	 * @template O Output type after pipe
	 * @param next Schema to validate the result with
	 * @returns Piped field
	 */
	pipe<O>(this: Field<Output>, next: Schema<O, unknown>): Field<O>;
	/**
	 * @template O Output type after pipe
	 * @param next Schema to validate the result with
	 * @returns Piped schema
	 */
	pipe<O>(
		this: Schema<Output, Input>,
		next: Schema<O, unknown>,
	): Schema<O, Input>;
	pipe<O>(this: Schema<Output, Input>, next: Schema<O, unknown>) {
		return this.derive((v, path) => next.parse(this.parse(v, path), path));
	}

	/**
	 * @param check Validation function that returns `false` to fail
	 * @param message Error message when validation fails
	 * @returns Refined field
	 */
	refine(
		this: Field<Output>,
		check: (value: Output) => boolean,
		message: string,
	): Field<Output>;
	/**
	 * @param check Validation function that returns `false` to fail
	 * @param message Error message when validation fails
	 * @returns Refined schema
	 */
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
		return this.derive((v, path) => {
			const out = this.parse(v, path);
			if (!check(out)) throw new Schema.Error(message, path);
			return out;
		});
	}

	/**
	 * Validate an input is a string.
	 *
	 * @returns String schema
	 */
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
	 * Validate an input is a `true` or `false` boolean.
	 *
	 * @returns Boolean schema
	 */
	static boolean() {
		return new Schema((v, path) => {
			if (typeof v !== "boolean") {
				throw new Schema.Error("Expected boolean", path);
			}

			return v;
		});
	}

	/**
	 * Validate an input is a number.
	 *
	 * Rejects `NaN`.
	 *
	 * @returns Number schema
	 */
	static number() {
		return new Schema((v, path) => {
			if (typeof v !== "number" || Number.isNaN(v)) {
				throw new Schema.Error("Expected number", path);
			}

			return v;
		});
	}

	/**
	 * Validate an input is an integer.
	 *
	 * @returns Integer schema
	 */
	static int() {
		return Schema.number().refine(Number.isInteger, "Expected integer");
	}

	/**
	 * Validate an input is a `Date`.
	 *
	 * Rejects invalid dates.
	 *
	 * @returns Date schema
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
	 * @template L Literal type
	 * @param literal Exact value to match
	 * @returns Literal schema
	 */
	static literal<const L>(literal: L) {
		return new Schema((v, path) => {
			if (v !== literal) {
				throw new Schema.Error(`Expected ${JSON.stringify(literal)}`, path);
			}

			return literal;
		});
	}

	/**
	 * Validates that the input is strictly equal (`===`) to one of the allowed
	 * values.
	 *
	 * @template A Allowed type
	 * @param allowed Allowed values
	 * @returns Enum schema
	 */
	static enum<const A extends readonly [unknown, ...unknown[]]>(allowed: A) {
		return new Schema((v, path) => {
			for (const a of allowed) {
				if (v === a) return a as A[number];
			}

			throw new Schema.Error(
				`Expected one of: ${allowed.map((v) => JSON.stringify(v)).join(", ")}`,
				path,
			);
		});
	}

	/**
	 * Tries each schema in order and returns the first successfully parsed result.
	 *
	 * @template S Schemas type
	 * @param schemas Schemas to try in order
	 * @returns Union schema
	 */
	static union<
		const S extends readonly [
			Schema<unknown, unknown>,
			...Schema<unknown, unknown>[],
		],
	>(schemas: S) {
		return new Schema((v, path) => {
			for (const schema of schemas) {
				try {
					return schema.parse(v, path) as Schema.Infer<S[number]>;
				} catch (e) {
					if (!(e instanceof Schema.Error)) throw e;
				}
			}

			throw new Schema.Error("Expected union variant", path);
		});
	}

	/**
	 * Parses a JSON string and then validates the parsed value with `inner`.
	 *
	 * @template O Output type
	 * @param inner Schema to validate the parsed JSON with
	 * @returns JSON schema
	 */
	static json<O>(inner: Schema<O, unknown>) {
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
	 * Validates that the input is a `File` instance.
	 *
	 * @returns File schema
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
	 * Validates that the input is an array and parses each item.
	 *
	 * @template O Output type
	 * @param item Schema for each array item
	 * @returns Array schema
	 */
	static array<O>(item: Schema<O, unknown>) {
		return new Schema((v, path) => {
			if (!Array.isArray(v)) {
				throw new Schema.Error("Expected array", path);
			}

			return Array.from(v, (value, i) => item.parse(value, [...path, i]));
		});
	}

	/**
	 * Validates each key in the shape and returns a new object of parsed outputs.
	 * Missing keys are passed as `undefined` so `.optional()` / `.default()` work.
	 *
	 * @template S Shape type
	 * @param shape Object shape with schemas for each key
	 * @returns Object schema
	 */
	static object<const S extends Schema.Shape>(shape: S) {
		return new ObjectSchema(shape);
	}

	/**
	 * Form schema with JSX rendering capabilities.
	 *
	 * Parses `FormData` and generates form field components.
	 *
	 * @template Shape Form field shape type
	 * @param fields Form fields
	 * @example
	 *
	 * ```tsx
	 * const User = Schema.form({
	 *   username: Schema.Field.text({ label: "Username" }),
	 *   admin: Schema.Field.checkbox(),
	 *   age: Schema.Field.number(),
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
	static form<Shape extends Schema.Form.Shape>(
		fields: Shape,
	): Schema.Form.Instance<Shape> {
		return new Form(fields);
	}

	/** Coercion schemas that apply JavaScript type coercion before validation. */
	static Coerce = class {
		/**
		 * Coerce to string using `String(value)`.
		 *
		 * @returns Coerced string schema
		 */
		static string() {
			return new Schema((v, path) => Schema.string().parse(String(v), path));
		}

		/**
		 * Coerce to number using `Number(value)`.
		 *
		 * @returns Coerced number schema
		 */
		static number() {
			return new Schema((v, path) => Schema.number().parse(Number(v), path));
		}

		/**
		 * Coerce to boolean using `Boolean(value)`.
		 *
		 * @returns Coerced boolean schema
		 */
		static boolean() {
			return new Schema((v) => Boolean(v));
		}

		/**
		 * Coerce to Date using `new Date(value)`. Rejects invalid dates.
		 *
		 * @returns Coerced date schema
		 */
		static date() {
			return new Schema((v, path) =>
				Schema.date().parse(new Date(String(v)), path),
			);
		}
	};

	static Field = class {
		/**
		 * @param type Type attribute value
		 * @param options Field options
		 * @returns Generic input field
		 */
		static #input(
			type: JSX.IntrinsicElements["input"]["type"],
			options: Field.Options = {},
		) {
			return new Field({ type, ...options }, Schema.string().parse);
		}

		/**
		 * @param options Field options
		 * @returns Text input field
		 */
		static text(options: Field.Options = {}) {
			return Schema.Field.#input("text", options);
		}

		/**
		 * @param options Field options
		 * @returns Password input field
		 */
		static password(options: Field.Options = {}) {
			return Schema.Field.#input("password", options);
		}

		/**
		 * @param options Field options
		 * @returns Search input field
		 */
		static search(options: Field.Options = {}) {
			return Schema.Field.#input("search", options);
		}

		/**
		 * @param options Field options
		 * @returns Telephone input field
		 */
		static tel(options: Field.Options = {}) {
			return Schema.Field.#input("tel", options);
		}

		/**
		 * @param options Field options
		 * @returns Color input field
		 */
		static color(options: Field.Options = {}) {
			return Schema.Field.#input("color", options);
		}

		/**
		 * @param options Field options
		 * @returns Hidden input field
		 */
		static hidden(options: Field.Options = {}) {
			return Schema.Field.#input("hidden", options);
		}

		/**
		 * @param options Field options
		 * @returns Date input field
		 */
		static date(options: Field.Options = {}) {
			return new Field(
				{ type: "date", ...options },
				Schema.Coerce.date().parse,
			);
		}

		/**
		 * @param options Field options
		 * @returns Datetime input field
		 */
		static datetime(options: Field.Options = {}) {
			return Schema.Field.#input("datetime-local", options);
		}

		/**
		 * @param options Field options
		 * @returns Month input field
		 */
		static month(options: Field.Options = {}) {
			return Schema.Field.#input("month", options);
		}

		/**
		 * @param options Field options
		 * @returns Week input field
		 */
		static week(options: Field.Options = {}) {
			return Schema.Field.#input("week", options);
		}

		/**
		 * @param options Field options
		 * @returns Time input field
		 */
		static time(options: Field.Options = {}) {
			return Schema.Field.#input("time", options);
		}

		/**
		 * Validates email string.
		 *
		 * @param options Field options
		 * @returns Email input field
		 */
		static email(options: Field.Options = {}) {
			return new Field({ type: "email", ...options }, Schema.email().parse);
		}

		/**
		 * Validates parsable URL.
		 *
		 * @param options Field options
		 * @returns URL input field
		 */
		static url(options: Field.Options = {}) {
			return new Field({ type: "url", ...options }, Schema.url().parse);
		}

		/**
		 * @param type Type attribute value
		 * @param options Field options
		 * @returns Input field
		 */
		static #number(type: "number" | "range", options: Field.Options = {}) {
			return new Field({ type, ...options }, Schema.Coerce.number().parse);
		}

		/**
		 * Coerces to number.
		 *
		 * @param options Field options
		 * @returns Number input field
		 */
		static number(options: Field.Options = {}) {
			return Schema.Field.#number("number", options);
		}

		/**
		 * Coerces to number.
		 *
		 * @param options Field options
		 * @returns Range input field
		 */
		static range(options: Field.Options = {}) {
			return Schema.Field.#number("range", options);
		}

		/**
		 * - unchecked => key missing => `false`
		 * - checked => key present => `true`
		 *
		 * @param options Field options
		 * @returns Checkbox input field
		 */
		static checkbox(options: Field.Options = {}) {
			return new Field(
				{ type: "checkbox", ...options },
				Schema.Coerce.boolean().parse,
				(formData, name) => formData.has(name),
			);
		}

		/**
		 * @param options Field options
		 * @returns File input field
		 */
		static file(options: Field.Options = {}) {
			return new Field({ type: "file", ...options }, Schema.file().parse);
		}

		/**
		 * @param options Field options
		 * @returns Multiple file input field
		 */
		static files(options: Field.Options = {}) {
			return new Field(
				{ type: "file", multiple: true, ...options },
				Schema.array(Schema.file()).parse,
				(formData, name) => formData.getAll(name),
			);
		}

		/**
		 * @template V Value type
		 * @param values Checkbox values
		 * @param options Field options
		 * @returns Checkbox group input field
		 */
		static checkboxes<const V extends string>(
			values: readonly [V, ...V[]],
			options: Field.Options = {},
		) {
			return new Field(
				{ type: "checkbox", values, ...options },
				Schema.array(Schema.enum(values)).parse,
				(formData, name) => formData.getAll(name),
			);
		}

		/**
		 * @template V Value type
		 * @param values Radio button values
		 * @param options Field options
		 * @returns Radio group input field
		 */
		static radio<const V extends string>(
			values: readonly [V, ...V[]],
			options: Field.Options = {},
		) {
			return new Field(
				{ type: "radio", values, ...options },
				Schema.enum(values).parse,
			);
		}

		/**
		 * @param options Field options
		 * @returns Textarea field
		 */
		static textarea(options: Field.Options = {}) {
			return new Field({ tag: "textarea", ...options }, Schema.string().parse);
		}

		/**
		 * @template V Value type
		 * @param values Select options
		 * @param options Field options
		 * @returns Multi-select field
		 */
		static multiselect<const V extends string>(
			values: readonly [V, ...V[]],
			options: Field.Options = {},
		) {
			return new Field(
				{ tag: "select", values, multiple: true, ...options },
				Schema.array(Schema.enum(values)).parse,
				(formData, name) => formData.getAll(name),
			);
		}

		/**
		 * @template V Value type
		 * @param values Select options
		 * @param options Field options
		 * @returns Select field
		 */
		static select<const V extends string>(
			values: readonly [V, ...V[]],
			options: Field.Options = {},
		) {
			return new Field(
				{ tag: "select", values, ...options },
				Schema.enum(values).parse,
			);
		}
	};
}

/**
 * Object schema with extend capability.
 *
 * @template Shape Shape type
 */
class ObjectSchema<const Shape extends Schema.Shape> extends Schema<
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
	 * Returns a new object schema with `extra` merged into the current shape.
	 *
	 * @template E Extra shape type
	 * @param extra Extra shape to merge
	 * @returns Extended object schema
	 */
	extend<const E extends Schema.Shape>(
		extra: E,
	): // return type required
	Schema.Object<Schema.Merge<Shape, E>> {
		return Schema.object({ ...this.shape, ...extra });
	}
}

export namespace Field {
	export type Read = (data: FormData, name: string) => unknown;

	export interface Options {
		/** Field label. */
		label?: string;

		/**
		 * Tag name.
		 *
		 * @default "input"
		 */
		tag?: "input" | "textarea" | "select";

		/** Input `type` attribute value */
		type?: JSX.IntrinsicElements["input"]["type"];

		/** Values are used for `input[type=radio|checkbox]`, and `select` elements */
		values?: readonly string[];

		/** Used for multiple-value inputs */
		multiple?: boolean;
	}

	/**
	 * Props available to users to pass into the constructed `<Field />` component.
	 *
	 * @template S Shape type
	 */
	export type Props<S> = { name: Extract<keyof S, string> } & (
		| JSX.IntrinsicElements["input"]
		| JSX.IntrinsicElements["textarea"]
		| JSX.IntrinsicElements["select"]
	);
}

/**
 * Represents a form field with parsing logic and rendering metadata.
 *
 * @template Output Output type of the field
 */
export class Field<Output> extends Schema<Output> {
	/** Read the value from form data */
	readonly read: Field.Read;

	/** Field options */
	readonly options: Field.Options;

	/**
	 * Create a new field.
	 *
	 * @param options Field options
	 * @param parse How to validate the input
	 * @param read How to read the data from `FormData`
	 */
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

	/**
	 * Derive a new Field from the current.
	 *
	 * @template O Output type of the new Field
	 * @param parse Parse function that validates and transforms input
	 * @returns New `Field` instance
	 */
	override derive<O>(parse: Schema.Parse<O>) {
		return new Field<O>(this.options, parse, this.read);
	}

	/**
	 * @template S Shape type
	 * @param props Field props including `name`
	 * @returns JSX Component that renders the HTML field
	 */
	render<S extends Record<string, Field<unknown>>>(props: Field.Props<S>) {
		const id = props.id ?? props.name;
		const { tag = "input", label = id, type, values, multiple } = this.options;

		return jsx("div", {
			children:
				type === "radio" || (type === "checkbox" && values)
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

/**
 * Form schema
 *
 * @template Shape Form field shape type
 */
class Form<Shape extends Schema.Form.Shape> implements Schema.Form
	.Instance<Shape> {
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

		for (const key in this.fields) {
			const schema = this.fields[key]!;
			out[key] = schema.parse(schema.read(data, key), [...path, key]);
		}

		return out as Schema.Form.Infer<Shape>;
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

		for (const name in this.fields) {
			const field = this.fields[name]!;
			children.push(field.render({ name }));
		}

		return jsx("fieldset", { ...props, children });
	};
}
