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

	// this is to improve inferred type performance to help ts infer objects
	/**
	 * Object schema with extend capability.
	 *
	 * @template S Shape type
	 */
	export type Object<S extends Shape> = Schema<Infer<S>, unknown> & {
		extend<E extends Shape>(extra: E): Object<Merge<S, E>>;
	};

	export namespace Field {
		export type Read = (data: FormData, name: string) => unknown;

		export type Tag = "input" | "textarea" | "select";

		export type Type = JSX.IntrinsicElements["input"]["type"];

		export type Values = readonly [string, ...string[]];

		export type Any = Field<unknown, Tag, Type | undefined, Values | undefined>;

		export type TagOf<F extends Any> =
			F extends Field<
				unknown,
				infer T,
				Schema.Field.Type | undefined,
				Schema.Field.Values | undefined
			>
				? T
				: Tag;

		export type ValuesOf<F extends Any> =
			F extends Field<
				unknown,
				Schema.Field.Tag,
				Schema.Field.Type | undefined,
				infer V
			>
				? V
				: Values | undefined;

		export type Root =
			| JSX.IntrinsicElements["div"]
			| JSX.IntrinsicElements["fieldset"];

		export type Label = JSX.IntrinsicElements["label"] & { value?: string };

		export type Legend = JSX.IntrinsicElements["legend"];

		export type Error = JSX.IntrinsicElements["div"];

		export type Control<T extends Tag> = T extends "textarea"
			? JSX.IntrinsicElements["textarea"]
			: T extends "select"
				? JSX.IntrinsicElements["select"]
				: JSX.IntrinsicElements["input"];

		export type Opt<V extends Values> = JSX.IntrinsicElements["label"] & {
			value: V[number];
			control?: JSX.IntrinsicElements["input"];
		};

		export type OptSelect<V extends Values> =
			JSX.IntrinsicElements["option"] & { value: V[number] };

		export type Bound<F extends Any> = {
			Root: (props?: Root) => JSX.Element;
			Label: (props?: Label) => JSX.Element;
			Control: (props?: Control<TagOf<F>>) => JSX.Element;
			Error: (props?: Error) => JSX.Element;
		} & (F extends Field<
			unknown,
			"select",
			Schema.Field.Type | undefined,
			infer V
		>
			? V extends Values
				? { values: V; Option: (props: OptSelect<V>) => JSX.Element }
				: {}
			: F extends Field<
						unknown,
						"input",
						Schema.Field.Type | undefined,
						infer V
				  >
				? V extends Values
					? {
							values: V;
							Option: (props: Opt<V>) => JSX.Element;
							Legend: (props?: Legend) => JSX.Element;
						}
					: {}
				: {});

		export interface Options<
			V extends Values | undefined = Values | undefined,
			T extends Tag = Tag,
		> {
			/**
			 * Tag name.
			 *
			 * @default "input"
			 */
			tag?: T;

			/**
			 * Values are used for `input[type=radio|checkbox]`, and
			 * `<select>` elements
			 */
			values?: V;

			/** Field props without `name` */
			props?: Omit<Props<never>, "name">;
		}

		/**
		 * Component props available to users to pass into the
		 * constructed `<Field />` component.
		 *
		 * @template S Shape type
		 */
		export type Props<S> = {
			/** Field name attribute */
			name: Extract<keyof S, string>;
		} & (Props.Input | Props.Select | Props.Textarea);

		export namespace Props {
			/** Extra props in addition to HTML attributes */
			type Meta = {
				/** Field label */
				label?: string;
			};

			/** Props for `<input>` factories */
			export type Input = Meta & JSX.IntrinsicElements["input"];

			/** Props for `<select>` factories */
			export type Select = Meta & JSX.IntrinsicElements["select"];

			/** Props for `<textarea>` factory */
			export type Textarea = Meta & JSX.IntrinsicElements["textarea"];
		}
	}

	/** Schema.Form instance type */
	export type Form<S extends Form.Shape> = InstanceType<typeof Schema.Form<S>>;

	export namespace Form {
		/** Form field shape. */
		export type Shape = Record<string, Field.Any>;

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
	optional<
		T extends Schema.Field.Tag,
		U extends Schema.Field.Type | undefined,
		V extends Schema.Field.Values | undefined,
	>(this: Field<Output, T, U, V>): Field<Output | undefined, T, U, V>;
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
	default<
		T extends Schema.Field.Tag,
		U extends Schema.Field.Type | undefined,
		V extends Schema.Field.Values | undefined,
	>(this: Field<Output, T, U, V>, value: Output): Field<Output, T, U, V>;
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
	transform<
		O,
		T extends Schema.Field.Tag,
		U extends Schema.Field.Type | undefined,
		V extends Schema.Field.Values | undefined,
	>(this: Field<Output, T, U, V>, fn: (value: Output) => O): Field<O, T, U, V>;
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
	pipe<
		O,
		T extends Schema.Field.Tag,
		U extends Schema.Field.Type | undefined,
		V extends Schema.Field.Values | undefined,
	>(this: Field<Output, T, U, V>, next: Schema<O, unknown>): Field<O, T, U, V>;
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
	refine<
		T extends Schema.Field.Tag,
		U extends Schema.Field.Type | undefined,
		V extends Schema.Field.Values | undefined,
	>(
		this: Field<Output, T, U, V>,
		check: (value: Output) => boolean,
		message: string,
	): Field<Output, T, U, V>;
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
	 * [Reasonable Email Regex by Colin McDonnell](https://colinhacks.com/essays/reasonable-email-regex)
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
	static object<const S extends Schema.Shape>(shape: S): Schema.Object<S> {
		return new Schema.Object(shape);
	}

	/**
	 * Form schema with JSX rendering capabilities.
	 *
	 * Parses `FormData` and generates form field components.
	 *
	 * @template S Form field shape type
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
	static form<S extends Schema.Form.Shape>(fields: S): Schema.Form<S> {
		return new Schema.Form(fields);
	}

	/**
	 * Object schema with extend capability.
	 *
	 * @template Shape Shape type
	 */
	static Object = class<const Shape extends Schema.Shape> extends Schema<
		Schema.Infer<Shape>,
		unknown
	> {
		/** Object schema's shape (user input object) */
		readonly #shape: Shape;

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

			this.#shape = shape;
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
			return Schema.object({ ...this.#shape, ...extra });
		}
	};

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
		 * @param props Input props
		 * @returns Generic input field
		 */
		static #input(
			props: Schema.Field.Props.Input & { type: Schema.Field.Type },
		) {
			return new Field({ props }, Schema.string().parse);
		}

		/**
		 * @param props Input props
		 * @returns Text input field
		 */
		static text(props?: Schema.Field.Props.Input) {
			return Schema.Field.#input({ ...props, type: "text" });
		}

		/**
		 * @param props Input props
		 * @returns Password input field
		 */
		static password(props?: Schema.Field.Props.Input) {
			return Schema.Field.#input({ ...props, type: "password" });
		}

		/**
		 * @param props Input props
		 * @returns Search input field
		 */
		static search(props?: Schema.Field.Props.Input) {
			return Schema.Field.#input({ ...props, type: "search" });
		}

		/**
		 * @param props Input props
		 * @returns Telephone input field
		 */
		static tel(props?: Schema.Field.Props.Input) {
			return Schema.Field.#input({ ...props, type: "tel" });
		}

		/**
		 * @param props Input props
		 * @returns Color input field
		 */
		static color(props?: Schema.Field.Props.Input) {
			return Schema.Field.#input({ ...props, type: "color" });
		}

		/**
		 * @param props Input props
		 * @returns Hidden input field
		 */
		static hidden(props?: Schema.Field.Props.Input) {
			return Schema.Field.#input({ ...props, type: "hidden" });
		}

		/**
		 * @param props Input props
		 * @returns Date input field
		 */
		static date(props?: Schema.Field.Props.Input) {
			return Schema.Field.#input({ ...props, type: "date" });
		}

		/**
		 * @param props Input props
		 * @returns Datetime input field
		 */
		static datetime(props?: Schema.Field.Props.Input) {
			return Schema.Field.#input({ ...props, type: "datetime-local" });
		}

		/**
		 * @param props Input props
		 * @returns Month input field
		 */
		static month(props?: Schema.Field.Props.Input) {
			return Schema.Field.#input({ ...props, type: "month" });
		}

		/**
		 * @param props Input props
		 * @returns Week input field
		 */
		static week(props?: Schema.Field.Props.Input) {
			return Schema.Field.#input({ ...props, type: "week" });
		}

		/**
		 * @param props Input props
		 * @returns Time input field
		 */
		static time(props?: Schema.Field.Props.Input) {
			return Schema.Field.#input({ ...props, type: "time" });
		}

		/**
		 * Validates email string.
		 *
		 * @param props Input props
		 * @returns Email input field
		 */
		static email(props?: Schema.Field.Props.Input) {
			return new Field(
				{ props: { ...props, type: "email" } },
				Schema.email().parse,
			);
		}

		/**
		 * Validates parsable URL.
		 *
		 * @param props Input props
		 * @returns URL input field
		 */
		static url(props?: Schema.Field.Props.Input) {
			return new Field(
				{ props: { ...props, type: "url" } },
				Schema.url().parse,
			);
		}

		/**
		 * @param props Input props
		 * @returns Input field
		 */
		static #number(
			props: Schema.Field.Props.Input & { type: "number" | "range" },
		) {
			return new Field({ props }, Schema.Coerce.number().parse);
		}

		/**
		 * Coerces to number.
		 *
		 * @param props Input props
		 * @returns Number input field
		 */
		static number(props?: Schema.Field.Props.Input) {
			return Schema.Field.#number({ ...props, type: "number" });
		}

		/**
		 * Coerces to number.
		 *
		 * @param props Input props
		 * @returns Range input field
		 */
		static range(props?: Schema.Field.Props.Input) {
			return Schema.Field.#number({ ...props, type: "range" });
		}

		/**
		 * - unchecked => key missing => `false`
		 * - checked => key present => `true`
		 *
		 * @param props Input props
		 * @returns Checkbox input field
		 */
		static checkbox(props?: Schema.Field.Props.Input) {
			return new Field(
				{ props: { ...props, type: "checkbox" } },
				Schema.Coerce.boolean().parse,
				(formData, name) => formData.has(name),
			);
		}

		/**
		 * @param props Input props
		 * @returns File input field
		 */
		static file(props?: Schema.Field.Props.Input) {
			return new Field(
				{ props: { ...props, type: "file" } },
				Schema.file().parse,
			);
		}

		/**
		 * @param props Input props
		 * @returns Multiple file input field
		 */
		static files(props?: Schema.Field.Props.Input) {
			return new Field(
				{ props: { ...props, type: "file", multiple: true } },
				Schema.array(Schema.file()).parse,
				(formData, name) => formData.getAll(name),
			);
		}

		/**
		 * @template V Value type
		 * @param values Checkbox values
		 * @param props Input props
		 * @returns Checkbox group input field
		 */
		static checkboxes<const V extends string>(
			values: readonly [V, ...V[]],
			props?: Schema.Field.Props.Input,
		) {
			return new Field(
				{ values, props: { ...props, type: "checkbox" } },
				Schema.array(Schema.enum(values)).parse,
				(formData, name) => formData.getAll(name),
			);
		}

		/**
		 * @template V Value type
		 * @param values Radio button values
		 * @param props Input props
		 * @returns Radio group input field
		 */
		static radio<const V extends string>(
			values: readonly [V, ...V[]],
			props?: Schema.Field.Props.Input,
		) {
			return new Field(
				{ values, props: { ...props, type: "radio" } },
				Schema.enum(values).parse,
			);
		}

		/**
		 * @param props Textarea props
		 * @returns Textarea field
		 */
		static textarea(props?: Schema.Field.Props.Textarea) {
			return new Field({ tag: "textarea", props }, Schema.string().parse);
		}

		/**
		 * @template V Value type
		 * @param values Select options
		 * @param props Select props
		 * @returns Select field
		 */
		static select<const V extends string>(
			values: readonly [V, ...V[]],
			props?: Schema.Field.Props.Select,
		) {
			return new Field(
				{ tag: "select", values, props },
				Schema.enum(values).parse,
			);
		}

		/**
		 * @template V Value type
		 * @param values Select options
		 * @param props Select props
		 * @returns Multi-select field
		 */
		static multiselect<const V extends string>(
			values: readonly [V, ...V[]],
			props?: Schema.Field.Props.Select,
		) {
			return new Field(
				{ tag: "select", values, props: { ...props, multiple: true } },
				Schema.array(Schema.enum(values)).parse,
				(formData, name) => formData.getAll(name),
			);
		}
	};

	/**
	 * Form schema
	 *
	 * @template Shape Form field shape type
	 */
	static Form = class<Shape extends Schema.Form.Shape> {
		/** Field definitions. */
		readonly #fields: Shape;

		/**
		 * Create a new form schema validator.
		 *
		 * @param fields Form fields
		 */
		constructor(fields: Shape) {
			this.#fields = fields;
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

			for (const key in this.#fields) {
				const schema = this.#fields[key]!;
				out[key] = schema.parse(schema.read(data, key), [...path, key]);
			}

			return out as Schema.Form.Infer<Shape>;
		}

		/**
		 * Field names in definition order.
		 */
		get names(): Array<Extract<keyof Shape, string>> {
			return Object.keys(this.#fields) as Array<Extract<keyof Shape, string>>;
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
		Field = (props: Schema.Field.Props<Shape>) =>
			this.#fields[props.name]!.render(props);

		/**
		 * Access bound subcomponents for a field.
		 *
		 * @param name Field name
		 * @example
		 *
		 * ```tsx
		 * const Radio = User.field("radio");
		 * ```
		 */
		field<K extends Extract<keyof Shape, string>>(
			name: K,
		): Schema.Field.Bound<Shape[K]>;
		field(name: Extract<keyof Shape, string>): unknown {
			return this.#fields[name]!.bind(name);
		}

		/**
		 * Render all form fields.
		 *
		 * @param props Component props
		 * @example
		 *
		 * ```tsx
		 * <User.Fields />
		 * ```
		 */
		Fields = () =>
			this.names.map((name) => this.#fields[name]!.render({ name }));
	};
}

/**
 * Represents a form field with parsing logic and rendering metadata.
 *
 * @template Output Output type of the field
 */
class Field<
	Output,
	Tag extends Schema.Field.Tag = "input",
	Type extends Schema.Field.Type | undefined = undefined,
	Values extends Schema.Field.Values | undefined = undefined,
> extends Schema<Output> {
	/** Read the value from form data */
	readonly read: Schema.Field.Read;

	/** Field options */
	readonly #options: Schema.Field.Options<Values, Tag>;

	/** Field tag */
	readonly tag: Tag;

	/** Field type */
	readonly type: Type;

	/** Field values */
	readonly values: Values;

	/**
	 * Create a new field.
	 *
	 * @param options Field  options
	 * @param parse How to validate the input
	 * @param read How to read the data from `FormData`
	 */
	constructor(
		options: Schema.Field.Options<Values, Tag>,
		parse: Schema.Parse<Output>,
		read?: Schema.Field.Read,
	) {
		super(parse);

		this.#options = options;
		this.tag = (options.tag ?? "input") as Tag;
		this.values = options.values as Values;

		this.read =
			read ??
			// default to FormData.get
			((data, name) => {
				const v = data.get(name);
				return v == null ? undefined : v;
			});

		this.type = (options.props as Schema.Field.Props.Input | undefined)
			?.type as Type;
	}

	/**
	 * Derive a new Field from the current.
	 *
	 * @template O Output type of the new Field
	 * @param parse Parse function that validates and transforms input
	 * @returns New `Field` instance
	 */
	override derive<O>(parse: Schema.Parse<O>) {
		return new Field<O, Tag, Type, Values>(this.#options, parse, this.read);
	}

	#props(name: string, props?: Omit<Schema.Field.Props<never>, "name">) {
		const base: Schema.Field.Props<Record<string, never>> = {
			...this.#options.props,
			...props,
			name,
		};
		base.id ??= name;
		base.label ??= name;
		if (this.tag === "input" && this.type && base.type == null) {
			base.type = this.type;
		}
		return base;
	}

	/**
	 * @param name Field name
	 * @returns Field sub components
	 */
	bind(
		this: Field<Output, Tag, Type, Values>,
		name: string,
		props?: Omit<Schema.Field.Props<never>, "name">,
	): Schema.Field.Bound<this>;
	bind(name: string, props?: Omit<Schema.Field.Props<never>, "name">): unknown {
		const base = this.#props(name, props);
		const id = base.id ?? name;

		const Root = (data?: Schema.Field.Root) =>
			jsx(
				this.type === "radio" || this.type === "checkbox" ? "fieldset" : "div",
				data ?? {},
			);

		const Label = (data?: Schema.Field.Label) => {
			const { value, children, ...rest } = data ?? {};
			const oid = value == null ? id : `${id}-${value}`;
			return jsx("label", {
				...rest,
				for: rest.for ?? oid,
				children: children ?? value ?? base.label,
			});
		};

		const Error = (data?: Schema.Field.Error) => jsx("div", data ?? {});

		if (this.values) {
			if (this.tag === "select") {
				const Control = (data?: Schema.Field.Control<"select">) =>
					jsx(this.tag, { ...base, ...data, name });

				return {
					Root,
					Label,
					Control,
					Error,
					Option: (data: Schema.Field.OptSelect<Schema.Field.Values>) =>
						jsx("option", { ...data, children: data.children ?? data.value }),
					values: this.values,
				};
			}

			if (this.tag === "input") {
				const Control = (data?: Schema.Field.Control<"input">) => {
					const ctrl = { ...base, ...data, name };
					const value = data?.value;
					if (value != null) {
						ctrl.id = data?.id ?? `${id}-${value}`;
					} else {
						ctrl.id ??= id;
					}
					return jsx(this.tag, ctrl);
				};

				return {
					Root,
					Label,
					Control,
					Error,
					Legend: (data?: Schema.Field.Legend) =>
						jsx("legend", { ...data, children: data?.children ?? base.label }),
					Option: (data: Schema.Field.Opt<Schema.Field.Values>) => {
						const { value, control, children, ...rest } = data;
						return [
							Label({ ...rest, value, children }),
							Control({ ...control, value }),
						];
					},
					values: this.values,
				};
			}
		}

		const Control = (data?: Schema.Field.Control<Tag>) =>
			jsx(this.tag, { ...base, ...data, name });

		return { Root, Label, Control, Error };
	}

	#renderGroup<S extends Record<string, Schema.Field.Any>>(
		this: Field<Output, "input", "radio" | "checkbox", Schema.Field.Values>,
		data: Schema.Field.Props<S>,
	) {
		const base = this.#props(data.name, data);
		const field = this.bind(base.name, data);

		return field.Root({
			children: [
				jsx("legend", { children: base.label }),
				this.values.map((value: string) => {
					return jsx("div", {
						children: [field.Control({ value }), field.Label({ value })],
					});
				}),
			],
		});
	}

	#renderSelect<S extends Record<string, Schema.Field.Any>>(
		this: Field<Output, "select", Type, Schema.Field.Values>,
		data: Schema.Field.Props<S>,
	) {
		const field = this.bind(data.name, data);

		return field.Root({
			children: [
				field.Label(),
				field.Control({
					children: this.values.map((value: string) =>
						jsx("option", { value, children: value }),
					),
				}),
			],
		});
	}

	#renderDefault<S extends Record<string, Schema.Field.Any>>(
		data: Schema.Field.Props<S>,
	) {
		const field = this.bind(data.name, data);

		return field.Root({ children: [field.Label(), field.Control()] });
	}

	/**
	 * @template S Shape type
	 * @param fieldProps Field props including `name`
	 * @returns JSX Component that renders the HTML field
	 */
	render<S extends Record<string, Schema.Field.Any>>(
		data: Schema.Field.Props<S>,
	) {
		if (
			this.values &&
			this.tag === "input" &&
			(this.type === "radio" || this.type === "checkbox")
		) {
			return this.#renderGroup(data);
		}

		if (this.values && this.tag === "select") {
			return this.#renderSelect(data);
		}

		return this.#renderDefault(data);
	}
}
