import { type JSX, jsx } from "../jsx/index.js";
import { Schema } from "./index.js";

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
	static text(options: Form.Options.Input = {}) {
		const { label, ...attrs } = options;

		attrs.type ??= "text";

		return new Field({ label, attrs }, Schema.string().parse);
	}

	/** Email input field. */
	static email(options: Form.Options.Input = {}) {
		const { label, ...attrs } = options;

		attrs.type ??= "email";

		return new Field({ label, attrs }, Schema.string().parse);
	}

	/** Password input field. */
	static password(options: Form.Options.Input = {}) {
		const { label, ...attrs } = options;

		attrs.type ??= "password";

		return new Field({ label, attrs }, Schema.string().parse);
	}

	/** URL input field. */
	static url(options: Form.Options.Input = {}) {
		const { label, ...attrs } = options;

		attrs.type ??= "url";

		return new Field({ label, attrs }, Schema.string().parse);
	}

	/** Hidden input field. */
	static hidden(options: Form.Options.Input = {}) {
		const { label, ...attrs } = options;

		attrs.type ??= "hidden";

		return new Field({ label, attrs }, Schema.string().parse);
	}

	/** Number input field. Coerces strings to numbers. */
	static number(options: Form.Options.Input = {}) {
		const { label, ...attrs } = options;

		attrs.type ??= "number";

		return new Field({ label, attrs }, Schema.coerce.number().parse);
	}

	/** Date input field. Coerces strings to Dates. */
	static date(options: Form.Options.Input = {}) {
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
	static checkbox(options: Form.Options.Input = {}) {
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
	) {
		const { label, ...attrs } = options;

		attrs.type ??= "radio";

		return new Field({ label, values, attrs }, Schema.enum(values).parse);
	}

	/** Textarea field. */
	static textarea(options: Form.Options.Textarea = {}) {
		const { label, ...attrs } = options;

		attrs.type ??= "textarea";

		return new Field({ tag: "textarea", label, attrs }, Schema.string().parse);
	}

	/** Select dropdown field. */
	static select<const T extends string>(
		values: readonly [T, ...T[]],
		options: Form.Options.Select = {},
	) {
		const { label, ...attrs } = options;

		return new Field(
			{ tag: "select", label, values, attrs },
			Schema.enum(values).parse,
		);
	}
}
