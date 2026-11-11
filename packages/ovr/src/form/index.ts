import { Fragment, type JSX, jsx } from "../jsx/index.js";
import type { Multipart } from "../multipart/index.js";
import {
	Schema,
	ShapeUtil,
	annotate,
	append,
	exact,
	normalizers,
	own,
} from "../schema/index.js";
import { Checksum, Codec, Size } from "../util/index.js";

export namespace Form {
	/** Form field shape. */
	export type Shape = Record<string, Field.Any>;

	/** Persisted form value */
	export type Value = string | number | boolean | string[];

	export namespace Value {
		/**
		 * Value map by field name.
		 *
		 * @template S Shape type
		 */
		export type Map<S extends Shape = Shape> = Partial<
			Record<ShapeUtil.Name<S>, Value>
		>;

		/**
		 * Initial values by field name, for example a record being edited.
		 * Values a field cannot render, such as dates and `null`, are skipped.
		 *
		 * @template S Shape type
		 */
		export type Initial<S extends Shape = Shape> = {
			readonly [K in ShapeUtil.Name<S>]?: unknown;
		};
	}

	/**
	 * Encoded form state.
	 *
	 * @template S Shape type to infer value keys from
	 */
	export interface State<S extends Shape = Shape> {
		/** Form id generated using the field names */
		readonly id: string;

		/** Non-empty list of validation issues */
		readonly issues?: Schema.Issue.List;

		/** Map of field names to possible values */
		readonly values?: Value.Map<S>;
	}

	export namespace Parse {
		/**
		 * Field names that are not marked to stream as multipart parts.
		 *
		 * @template S Form shape
		 */
		type NonStreamNames<S extends Shape> = {
			[K in keyof S]-?: S[K] extends Field.Instance<any, any, any, any, infer P>
				? P extends true
					? never
					: K
				: never;
		}[keyof S];

		/**
		 * Parsed data shape with streamed `stream()` fields removed.
		 *
		 * @template S Form shape
		 */
		type NonStreamShape<S extends Shape> = Pick<S, NonStreamNames<S>>;

		/**
		 * Parsed form data output.
		 *
		 * @template S Form shape
		 */
		export type Data<S extends Shape> = Schema.Infer<NonStreamShape<S>>;

		/**
		 * Form parse result.
		 *
		 * @template S Form shape
		 * @template M Extra invalid result metadata
		 */
		export type Result<
			S extends Shape,
			M extends object = {},
		> = Schema.Parse.Result<
			Data<S>,
			Result.Invalid<M>,
			{
				/** Rest of the multipart parts to stream */
				readonly stream?: AsyncGenerator<Multipart.Part> | undefined;

				/**
				 * Create an invalid result for issues found after parsing, for
				 * example a database constraint, keeping persisted values.
				 *
				 * @param messages Issue message by field name
				 */
				readonly invalid: (
					messages: Messages<S>,
				) => Schema.Parse.Invalid & Result.Invalid<M>;
			}
		>;

		/**
		 * Issue messages by field name.
		 *
		 * @template S Form shape
		 */
		export type Messages<S extends Shape> = {
			readonly [K in ShapeUtil.Name<S>]?: string;
		};

		export namespace Result {
			/** Form search params iterable */
			export type Search = [[(typeof Form.params)[1], string]] | undefined;

			/**
			 * Invalid result metadata.
			 *
			 * @template M Extra invalid result metadata
			 */
			export type Invalid<M extends object = {}> = {
				/** Encoded URL search param field state */
				readonly search: Search;

				/** Invalid parses do not expose remaining multipart parts */
				readonly stream?: never;
			} & M;
		}
	}
}

/** Internal protocol for a GET route, to make the form its fields render. */
export const query = Symbol("query");

/**
 * Maximum encoded state size in bytes. Outside the class, since a static that
 * reads another module is a side effect, which keeps `Form` in bundles that
 * only use `Field`.
 */
const maxStateBytes = 4 * Size.kb;

/**
 * Form schema with JSX rendering capabilities.
 *
 * Parses `FormData` or `URLSearchParams` and generates form field
 * components.
 *
 * @template Shape Form field shape type
 */
export class Form<Shape extends Form.Shape = Form.Shape> {
	/** Query param keys ordered as `[return, form]`. */
	static readonly params = ["_return", "_form"] as const;

	/** Maximum serialized size for a single persisted value. */
	static readonly #maxValueChars = 512;

	/** Schema used to validate persisted form values, see `#value`. */
	static #valueSchema?: Schema<Form.Value>;

	/** Form id. */
	readonly #id: string;

	/**
	 * If search params fill the fields by name, as a GET form submits them.
	 * Other forms restore only what they persisted, so a link cannot fill them.
	 */
	#query = false;

	/** Field definitions. */
	readonly shape: Shape;

	/** Field names in definition order. */
	readonly names: ShapeUtil.Name<Shape>[];

	/** Maximum expected multipart parts derived from field cardinality. */
	readonly parts: number;

	/**
	 * Create a new form schema validator.
	 *
	 * @param shape Form fields
	 */
	constructor(shape: Shape) {
		this.shape = shape;
		this.names = Object.keys(this.shape) as ShapeUtil.Name<Shape>[];
		this.#id = Checksum.djb2(this.names.join());
		this.parts = Object.values(this.shape).reduce(
			(sum, field) => sum + field.parts,
			0,
		);
	}

	/**
	 * Built on first use: a schema built as the class loads is a side effect,
	 * which would keep `Form` in bundles that only use `Field`.
	 *
	 * @returns Schema used to validate persisted form values
	 */
	static #value() {
		return (Form.#valueSchema ??= Schema.union([
			Schema.string(),
			Schema.number(),
			Schema.boolean(),
			Schema.array(Schema.string()),
		]));
	}

	/** @returns The form for a GET route, whose submission is the page's URL */
	[query]() {
		const form = new Form(this.shape);
		form.#query = true;
		return form;
	}

	/**
	 * Merge `extra` into the current fields.
	 *
	 * @template E Extra field shape type
	 * @param extra Extra fields or form schema to merge
	 * @returns New form schema with merged fields
	 */
	extend: {
		<E extends Form.Shape>(extra: E): Form<ShapeUtil.Extend<Shape, E>>;
		<E extends Form.Shape>(extra: Form<E>): Form<ShapeUtil.Extend<Shape, E>>;
		(extra: Form<any>): Form<ShapeUtil.Extend<Shape, Form.Shape>>;
	} = (extra: Form.Shape | Form<any>) =>
		new Form(
			ShapeUtil.extend(this.shape, extra instanceof Form ? extra.shape : extra),
		);

	/**
	 * Keep only selected field names.
	 *
	 * @template N Selected field names
	 * @param names Non-empty list of field names to keep
	 * @returns New form schema with only selected fields
	 */
	pick = <N extends ShapeUtil.Name<Shape>>(names: readonly [N, ...N[]]) =>
		new Form(ShapeUtil.pick(this.shape, names));

	/**
	 * Remove selected field names.
	 *
	 * @template N Field names to remove
	 * @param names Non-empty list of field names to remove
	 * @returns New form schema without selected fields
	 */
	omit = <N extends ShapeUtil.Name<Shape>>(names: readonly [N, ...N[]]) =>
		new Form(ShapeUtil.omit(this.shape, names));

	/**
	 * @param name Form data name
	 * @returns The field, own fields only, so a name such as "constructor" has none
	 */
	#field(name: string) {
		return Object.hasOwn(this.shape, name) ? this.shape[name] : undefined;
	}

	/**
	 * @param name Unexpected form field name
	 * @param path Parent path
	 * @returns Schema issue for unexpected form field names
	 */
	#unexpected(name: string, path: Schema.Issue.Path = []) {
		return new Schema.Issue(
			"known form data name",
			[...path, name],
			"Unexpected form data name",
		);
	}

	/**
	 * Sanitizes render-state values by removing unsupported or oversized entries.
	 *
	 * @param values Candidate values to keep
	 * @param persist When `true`, only allow fields marked with `.persist()`
	 * @param limit When `true`, drop values too long to keep in the URL
	 * @returns Sanitized values
	 */
	#sanitize(values?: Record<string, unknown>, persist = true, limit = true) {
		const sanitized: Form.Value.Map<Shape> = {};

		if (values) {
			for (const [name, value] of Object.entries(values)) {
				const field = this.#field(name);

				if (
					field &&
					field.type !== "file" &&
					(!persist || FieldSchema.persisted(field)) &&
					value != null
				) {
					const result = Form.#value().parse(value);

					if (
						!result.issues &&
						(!limit ||
							JSON.stringify(result.data).length <= Form.#maxValueChars)
					) {
						own(sanitized, name, result.data);
					}
				}
			}

			if (Object.keys(sanitized).length) return sanitized;
		}
	}

	/**
	 * Decode form state, over the initial values.
	 *
	 * @param stateInput Current page URL
	 * @param initial Initial values, submitted values take precedence
	 */
	#decode(
		stateInput?: URL,
		initial?: Form.Value.Initial<Shape>,
	): Form.State<Shape> | undefined {
		const state = this.#restore(stateInput);
		// initial values come from the server, not the URL, so no size limit
		const values = this.#sanitize(initial, false, false);

		if (!values) return state;

		return { id: this.#id, ...state, values: { ...values, ...state?.values } };
	}

	/**
	 * Restore form state from the URL.
	 *
	 * @param stateInput Current page URL
	 */
	#restore(stateInput?: URL): Form.State<Shape> | undefined {
		if (stateInput) {
			const { searchParams } = stateInput;
			const values = this.#sanitize(
				(this.#query ? this.names : []).reduce<Record<string, unknown>>(
					(data, name) => {
						if (searchParams.has(name)) {
							const value = FieldSchema.read(
								this.shape[name]!,
								searchParams,
								name,
							);

							if (value != null) own(data, name, value);
						}

						return data;
					},
					{},
				),
				false,
			);
			const encoded = searchParams.get(Form.params[1]);

			if (encoded && encoded.length <= maxStateBytes * 2) {
				try {
					const result = Schema.string()
						.json(
							Schema.object({
								id: Schema.literal(this.#id),
								issues: Schema.array(
									Schema.object({
										expected: Schema.string(),
										path: Schema.array(
											Schema.union([Schema.string(), Schema.number()]),
										),
										message: Schema.string(),
									}).transform(
										(issue) =>
											new Schema.Issue(
												issue.expected,
												issue.path,
												issue.message,
											),
									),
								).optional(),
								values: Schema.object(
									this.names.reduce<Schema.Object.Shape>((shape, name) => {
										own(shape, name, Form.#value().optional());

										return shape;
									}, {}),
								).optional(),
							}),
						)
						.parse(Codec.decode(Codec.Base64Url.decode(encoded)));

					// valid only for this form, its id is a literal
					if (!result.issues) {
						const current = this.#sanitize(result.data.values);

						return {
							...result.data,
							values: (values || current) && { ...values, ...current },
						} as unknown as Form.State<Shape>;
					}
				} catch {}
			}

			return values && { id: this.#id, values };
		}
	}

	/**
	 * Create an invalid result, encoding the issues and persisted values so the
	 * next render can show them.
	 *
	 * @param issues Issues
	 * @param values Submitted values, only persisted fields are kept
	 * @returns Invalid result with its encoded search param
	 */
	#invalid(issues: Schema.Issue[], values: Record<string, unknown>) {
		const result = new Schema.AggregateIssue(issues, this.#sanitize(values));
		const persisted = result.values;
		let search: Form.Parse.Result.Search;

		// encode everything first, then trim persisted values until the state fits
		for (let i = this.names.length; ; i--) {
			const state = Codec.encode(
				JSON.stringify({
					issues: result.issues,
					id: this.#id,
					// issues only when nothing is persisted
					...(persisted && Object.keys(persisted).length
						? { values: persisted }
						: {}),
				} satisfies Form.State),
			);

			if (state.byteLength <= maxStateBytes) {
				search = [[Form.params[1], Codec.Base64Url.encode(state)]];
				break;
			}

			if (!persisted || !i) break;

			delete persisted[this.names[i - 1]!];
		}

		return Object.assign(result, { search });
	}

	/**
	 * Parse and validate form data.
	 *
	 * @param source FormData, URLSearchParams, or Multipart to parse
	 * @param path Internal path reference
	 * @returns Parsed result
	 */
	parse = async (
		source: FormData | URLSearchParams | Multipart,
		path: Schema.Issue.Path = [],
	): Promise<Form.Parse.Result<Shape>> => {
		const data: Record<string, unknown> = {};
		const issues: Schema.Issue[] = [];
		const values: Record<string, unknown> = {};
		let form: FormData | URLSearchParams;
		let stream: AsyncGenerator<Multipart.Part> | undefined;

		if (source instanceof FormData) {
			form = source;

			for (const name of new Set(source.keys())) {
				if (!this.#field(name)) issues.push(this.#unexpected(name, path));
			}
		} else if (source instanceof URLSearchParams) {
			form = source;
		} else {
			// the only other source is a Multipart, read one part at a time
			form = new FormData();
			const iter = source[Symbol.asyncIterator]();

			// a failure ends the parts, which also stops the upload
			try {
				let current: IteratorResult<Multipart.Part>;

				while ((current = await iter.next()) && !current.done) {
					const part = current.value;

					if (part.name) {
						const field = this.#field(part.name);

						if (!field) {
							issues.push(this.#unexpected(part.name, path));
						} else if (field.streaming) {
							// expose current and rest of the parts to the user
							stream = (async function* () {
								try {
									// have to yield the current part first
									// this is why the multipart can't be passed directly
									yield part;

									let next: IteratorResult<Multipart.Part>;

									while ((next = await iter.next()) && !next.done) {
										yield next.value;
									}
								} finally {
									try {
										await iter.return?.();
									} catch {}
								}
							})();

							break;
						} else {
							form.append(part.name, await part.value());
						}
					}
				}
			} catch (error) {
				await iter.return?.().catch(() => {});
				throw error;
			}
		}

		for (const [name, field] of Object.entries(this.shape)) {
			if (!field.streaming) {
				const value = FieldSchema.read(field, form, name);
				const result = field.parse(value, [...path, name]);

				if (result.issues) {
					append(issues, result.issues);
				} else if (result.data !== undefined) {
					own(data, name, result.data);
				}

				// a cleared field is recorded empty, so it overrides initial values
				if (FieldSchema.persisted(field)) own(values, name, value ?? "");
			}
		}

		if (issues.length) {
			if (stream) {
				// invalid result does not expose streamed parts, drain
				try {
					for await (const _ of stream);
				} catch {}
			}

			return this.#invalid(issues, values);
		}

		return {
			data: data as Form.Parse.Data<Shape>,
			stream,
			invalid: (messages: Form.Parse.Messages<Shape>) =>
				this.#invalid(
					Object.entries(messages).flatMap(([name, message]) =>
						typeof message === "string"
							? [new Schema.Issue("valid", [name], message)]
							: [],
					),
					values,
				),
		};
	};

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
	Field = ({
		values,
		...props
	}: Field.Component.Props<Shape> & {
		values?: Form.Value.Initial<Shape> | undefined;
	}) =>
		this.shape[props.name]!.render({
			...props,
			state: this.#decode(props.state, values),
		});

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
	Fields = ({
		values,
		...props
	}: // partial because name is not required
	Partial<Field.Component.Props<Shape>> & {
		values?: Form.Value.Initial<Shape> | undefined;
	} = {}) => {
		const state = this.#decode(props.state, values); // pulled out to not call each map iteration

		return this.names.map((name) =>
			this.shape[name]!.render({ ...props, name, state }),
		);
	};

	/**
	 * Access bound sub-components for a field.
	 *
	 * @template N Type of the form field name
	 * @param props Field component props
	 * @example
	 *
	 * ```tsx
	 * const Radio = User.component({ name: "radio" });
	 *
	 * <Radio.Label />
	 * <Radio.Control />
	 * ```
	 */
	component = <N extends ShapeUtil.Name<Shape>>({
		values,
		...props
	}: { name: N } & Field.Component.Props<Shape> & {
			values?: Form.Value.Initial<Shape> | undefined;
		}): Field.Component<Shape[N]> =>
		this.shape[props.name]!.component({
			...props,
			state: this.#decode(props.state, values),
		});
}

/**
 * Represents a form field with parsing logic and rendering metadata.
 *
 * @template Output Output type of the field
 * @template Tag Tag name
 * @template Type Input type
 * @template Values Persisted field value type
 * @template Stream If the field should be streamed as a part
 */
class FieldSchema<
	Output = unknown,
	Tag extends Field.Tag = "input",
	Type extends Field.Type = Field.Type,
	Values extends Field.Values | undefined = undefined,
	Stream extends boolean | undefined = undefined,
> extends Schema<Output> {
	/** Read the value from form data */
	readonly #read: Field.Read;

	/** Field type */
	readonly type: Type;

	// tag and values are public so emitted .d.ts preserves
	// field discriminants for correct types
	/** Field tag */
	readonly tag: Tag;

	/** Field values */
	readonly values: Values;

	/** Maximum expected multipart part count for this field name. */
	readonly parts: number;

	/** If the field should be streamed as a part */
	readonly streaming: Stream | undefined;

	/** If the field should persist invalid-state values. */
	readonly #persist: boolean;

	/** Field options */
	readonly #options: Field.Options<Values, Tag>;

	/** If the control can't be left empty, found on first render */
	#requires?: boolean;

	/**
	 * Create a new field.
	 *
	 * @param options Field options
	 * @param schema How to validate the input
	 * @param read How to read the form data
	 * @param parts Maximum expected multipart parts for this field
	 * @param stream If this field should be streamed as a multipart part
	 * @param persist If this field should persist invalid state values
	 */
	constructor(
		options: Field.Options<Values, Tag>,
		schema: Schema<Output> | Schema.Def,
		// default to a single value, treating blank as missing
		read: Field.Read = (data, name) => data.get(name) || undefined,
		parts = 1,
		stream?: Stream,
		persist = false,
	) {
		super(schema instanceof Schema ? schema.def : schema);

		this.#options = options;
		this.tag = (options.tag ?? "input") as Tag;
		this.values = options.values as Values;
		this.#read = read;
		this.type = options.props?.type as Type;
		this.parts = parts;
		this.streaming = stream;
		this.#persist = persist;
	}

	/**
	 * @returns `true` when the control can't be left empty
	 */
	#required() {
		return (this.#requires ??=
			// a lone checkbox reads as false, and `required` on each box of a
			// group would make every box required
			this.type !== "checkbox" &&
			this.type !== "hidden" &&
			Boolean(this.parse(this.#read(new URLSearchParams(), "")).issues));
	}

	/** How each picker writes its value */
	static readonly #formats: Record<string, string | undefined> = {
		date: "Date as YYYY-MM-DD",
		"datetime-local": "Date and time as YYYY-MM-DDTHH:mm",
		month: "Month as YYYY-MM",
		week: "Week as YYYY-Www, such as 2026-W46",
		time: "Time as HH:mm",
		color: "Color as #rrggbb",
	};

	/**
	 * @internal The label people read, which names a terse field such as
	 * `dob`, and an unchecked box's default
	 * @param io Side of the description
	 * @returns Keywords added to the property's JSON Schema
	 */
	override [annotate](io: "input" | "output") {
		const { label, description } = this.#options;
		// what a browser's picker sends, which a string alone does not say
		const format = FieldSchema.#formats[this.type as string];
		const described = [description?.replace(/\.$/, ""), format]
			.filter(Boolean)
			.join(". ");

		return {
			...(label && { title: label }),
			...(described && { description: described }),
			...(this.type === "date" && { format: "date" }),
			// a browser leaves an unchecked box out and it reads as false, so
			// input, such as an agent's, may leave it out too
			...(io === "input" &&
				this.type === "checkbox" &&
				!this.values && { default: false }),
		};
	}

	/**
	 * @param field Field instance
	 * @param data Form data source
	 * @param name HTML name attribute
	 * @returns Raw field input
	 */
	static read(
		field: Field.Any,
		data: FormData | URLSearchParams,
		name: string,
	) {
		return field.#read(data, name);
	}

	/**
	 * Stream this field as a multipart request `Part`.
	 *
	 * @returns Part field
	 */
	stream(): Field.Instance<Output, Tag, Type, Values, true> {
		return this.#copy({ stream: true });
	}

	/**
	 * Name the field. People read it as the control's label, or a group's
	 * legend, and agents as the field's `title`. Without one it is the field's
	 * name.
	 *
	 * ```ts
	 * Field.email().label("Email address");
	 * ```
	 *
	 * @param text Label
	 * @returns Field with the label
	 */
	label(text: string): Field.Instance<Output, Tag, Type, Values, Stream> {
		return this.#with({ label: text });
	}

	/**
	 * Say how to fill the field in. People read it under the control, and
	 * agents as the field's `description`, as a route's `describe()` is its
	 * tool's.
	 *
	 * ```ts
	 * Field.url().describe("An http or https address");
	 * ```
	 *
	 * @param text Description
	 * @returns Field with the description
	 */
	describe(text: string): Field.Instance<Output, Tag, Type, Values, Stream> {
		return this.#with({ description: text });
	}

	/**
	 * Attributes for the field's control wherever it renders, such as a
	 * placeholder. Those for one form are passed when it renders.
	 *
	 * ```ts
	 * Field.email().control({ placeholder: "name@example.com" });
	 * ```
	 *
	 * @param attributes Attributes of the control's element
	 * @returns Field with the attributes
	 */
	control(
		attributes: Tag extends "select"
			? Field.Props.Select
			: Tag extends "textarea"
				? Field.Props.Textarea
				: // the field is its type
					Field.Props.Input & { readonly type?: never },
	): Field.Instance<Output, Tag, Type, Values, Stream> {
		return this.#with({
			props: { ...this.#options.props, ...attributes } as Field.Props,
		});
	}

	/**
	 * @param options Options to change
	 * @returns The same field with them
	 */
	#with(options: Pick<Field.Options, "label" | "description" | "props">) {
		return this.#copy({ options: { ...this.#options, ...options } });
	}

	/**
	 * @template O Output type of the copy
	 * @template S If the copy streams as a part
	 * @param changes What the copy changes, the rest is this field's
	 * @returns A copy of this field
	 */
	#copy<O = Output, S extends boolean | undefined = Stream>({
		options = this.#options,
		def = this.def,
		stream = this.streaming as S,
		persist = this.#persist,
	}: {
		options?: Field.Options<Values, Tag>;
		def?: Schema.Def;
		stream?: S;
		persist?: boolean;
	}) {
		return new FieldSchema<O, Tag, Type, Values, S>(
			options,
			def,
			this.#read,
			this.parts,
			stream,
			persist,
		);
	}

	/**
	 * Persist this field in the encoded invalid form state.
	 *
	 * Use this for non-sensitive values that should refill after an invalid
	 * redirect.
	 *
	 * @template U Input type, one that can persist: not a password or file
	 * @returns Field that persists submitted values across invalid redirects
	 */
	persist<
		U extends (Tag extends "input" ? Exclude<Type, "password" | "file"> : Type),
	>(
		this: Field.Instance<Output, Tag, U, Values, Stream>,
	): Field.Instance<Output, Tag, U, Values, Stream>;
	persist() {
		return this.#copy({ persist: true });
	}

	/**
	 * Derive a new Field from the current instance type.
	 *
	 * @template O Output type of the new Field
	 * @param def Definition of the new Field
	 * @returns New `Field` instance
	 */
	override derive<O>(
		def: Schema.Def,
	): Field.Instance<O, Tag, Type, Values, Stream> {
		return this.#copy<O>({ def });
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Field component with sub-components
	 */
	component<S extends Form.Shape>(
		props: Field.Component.Props<S, false>,
	): Field.Component<this>;
	component<S extends Form.Shape>({
		state,
		...props
	}: Field.Component.Props<S, false>): unknown {
		const value = state?.values?.[props.name];
		const issue = state?.issues?.find((i) => i.path[0] === props.name);
		const issueId = issue && `${props.name}-issue`;
		const hidden = this.type === "hidden";
		const { label = props.name, description } = this.#options;
		const descriptionId =
			description && !hidden ? `${props.name}-description` : undefined;
		const control = {
			id: hidden ? undefined : props.name,
			required: this.#required(),
			autofocus: issue && state?.issues?.[0] === issue,
			"aria-invalid": issue && "true",
			// read with the control: its description, then what is wrong with it
			"aria-describedby":
				[descriptionId, issueId].filter(Boolean).join(" ") || undefined,
			...this.#options.props,
			...props,
		};

		/**
		 * @param option Option value
		 * @returns `true` when the value has the option
		 */
		const chosen = (option: string) =>
			Array.isArray(value)
				? value.includes(option) // checkboxes and multiselect
				: value === option; // radio and select

		const Description = (data: Field.Component.Description = {}) =>
			descriptionId && // render nothing without a description
			jsx("p", {
				id: descriptionId,
				children: description,
				"data-description": true,
				...data,
			});

		const Issue = (data: Field.Component.Issue = {}) =>
			issue && // render nothing if no issue
			!hidden &&
			jsx("p", {
				id: issueId,
				children: issue.message,
				"data-issue": issue && state!.issues!.indexOf(issue), // issue index starting from 0
				...data,
			});

		if (this.values && this.tag !== "select") {
			// radio/checkboxes
			// make multiple ids for the group so all don't have the same id
			const groupId = (value: string) =>
				`${control.name}-${value}`.toLowerCase();

			const Control = (
				data: Field.Component.Control.Group<"input", Field.Values>,
			) =>
				jsx(this.tag, {
					...control,
					id: groupId(data.value),
					// autofocus only the first input in the group
					autofocus: control.autofocus && data.value === this.values?.[0],
					checked: chosen(data.value),
					...data,
				});

			const Label = ({
				value,
				...rest
			}: Field.Component.Label.Group<Field.Values>) =>
				jsx("label", { for: groupId(value), children: value, ...rest });

			return {
				Description,
				Issue,
				Label,
				Control,
				Root: (data: Field.Component.Root = {}) => jsx("fieldset", data),
				Option: ({
					value,
					...rest
				}: Field.Component.Option.Input<Field.Values>) =>
					jsx("div", {
						children: [Control({ value }), Label({ value })],
						...rest,
					}),
				Legend: (data: Field.Component.Legend = {}) =>
					jsx("legend", { children: label, ...data }),
				...this,
			};
		}

		return {
			Description,
			Issue,
			Root: (data: Field.Component.Root = {}) =>
				hidden ? Fragment(data) : jsx("div", data),
			Label: (data: Field.Component.Label = {}) =>
				!hidden && jsx("label", { for: control.id, children: label, ...data }),
			Control: (data?: Field.Component.Control<Tag>) => {
				const attrs = { ...control, ...data };

				if (value !== undefined) {
					if (this.tag === "textarea") {
						attrs.children = value;
					} else if (this.tag === "input") {
						if (this.type === "checkbox") {
							attrs.checked = value;
						} else {
							attrs.value = value;
						}
					}
				}

				return jsx(this.tag, attrs);
			},
			Option:
				// select
				this.values &&
				((data: Field.Component.Option<Field.Values>) =>
					jsx("option", {
						children: data.value,
						selected: chosen(data.value),
						...data,
					})),
			...this,
		};
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props including `name` of the field to render
	 * @returns Component that renders the HTML field with default structure
	 */
	render<S extends Form.Shape>(props: Field.Component.Props<S, false>) {
		// the sub-components of each kind of field, told apart by `values` and `tag` below
		const c = this.component(props) as unknown as Field.Component<Field.Any> & {
			Legend: (props?: Field.Component.Legend) => JSX.Element;
			Option: (props: Field.Component.Option<Field.Values>) => JSX.Element;
		};
		const { values } = this;

		return c.Root({
			children: [
				values && this.tag !== "select"
					? // radio/checkboxes, a group with a legend, each value labelled
						[
							c.Legend(),
							values.map((value) =>
								jsx("div", {
									children: [c.Control({ value }), c.Label({ value })],
								}),
							),
						]
					: [
							c.Label(),
							// a select has an option for each value
							c.Control(
								values && {
									children: values.map((value) => c.Option({ value })),
								},
							),
						],
				c.Description(),
				c.Issue(),
			],
		});
	}

	/**
	 * @param field Field definition
	 * @returns `true` when the field persists invalid-state values
	 */
	static persisted(field: Field.Any) {
		return field.#persist;
	}
}

/**
 * @param value Schema
 * @returns `true` for a form field, such as a table column made with `Field`
 */
export const field = (value: unknown): value is Field.Any =>
	value instanceof FieldSchema;

export namespace Field {
	/**
	 * Base options to create a Field.
	 *
	 * @template V Type of the values for group inputs
	 * @template T Tag name
	 */
	export interface Options<
		V extends Values | undefined = undefined,
		T extends Tag = Tag,
	> {
		/**
		 * Tag name.
		 *
		 * @default "input"
		 */
		readonly tag?: T;

		/** Values are used for group inputs */
		readonly values?: V;

		/** What people call the field, set with `label()` */
		readonly label?: string;

		/** How to fill the field in, set with `describe()` */
		readonly description?: string;

		/** Field props */
		readonly props?: Props | undefined;
	}

	/**
	 * Raw field value before schema parsing.
	 *
	 * Single-value fields read one entry, multi-value fields read all entries,
	 * and checkboxes read presence.
	 */
	export type Input =
		FormDataEntryValue | FormDataEntryValue[] | boolean | undefined;

	/**
	 * @param data FormData or URLSearchParams
	 * @param name HTML name attribute
	 * @returns Resolved value read from the form data
	 */
	export type Read = (data: FormData | URLSearchParams, name: string) => Input;

	/** Form field tag name */
	export type Tag = "input" | "textarea" | "select";

	/** `<input type=...>` */
	export type Type = JSX.IntrinsicElements["input"]["type"];

	/** Value type for select and radio options */
	export type Values = readonly [string, ...string[]];

	/**
	 * Field instance type
	 *
	 * @template Output Parsed value
	 * @template Tag Element tag
	 * @template Type Input type
	 * @template Values Options of a select, radio, or checkbox group
	 * @template Stream Whether the field streams as a multipart part
	 */
	export type Instance<
		Output = unknown,
		Tag extends Field.Tag = "input",
		Type extends Field.Type = Field.Type,
		Values extends Field.Values | undefined = undefined,
		Stream extends boolean | undefined = undefined,
	> = FieldSchema<Output, Tag, Type, Values, Stream>;

	/** Any field - `<input type=...>` / `<select>` / `<textarea>` */
	export type Any = Instance<
		any,
		Tag,
		Type,
		Values | undefined,
		boolean | undefined
	>;

	/**
	 * Obtain the tag name of a field.
	 *
	 * @template F Field
	 */
	export type TagOf<F extends Any> =
		F extends Instance<any, infer T, Field.Type, Field.Values | undefined>
			? T
			: Tag;

	export namespace Component {
		/**
		 * Component props available to users to pass into the
		 * constructed `<Field />` component.
		 *
		 * @template S Form shape type
		 * @template I `true` the state is a `URL`, `false` is just `State`
		 */
		export type Props<S extends Form.Shape, I extends boolean = true> = {
			/** Field name attribute */
			readonly name: ShapeUtil.Name<S>;

			/** Form state */
			readonly state?: (I extends true ? URL : Form.State<S>) | undefined;
		} & Field.Props;

		/** Root element for the Field component */
		export type Root = JSX.IntrinsicElements["div"];

		export namespace Root {
			/** Root for input groups */
			export type Group = JSX.IntrinsicElements["fieldset"];
		}

		/** `<Field.Legend />` component props */
		export type Legend = JSX.IntrinsicElements["legend"];

		/** `<Field.Description />` component props */
		export type Description = JSX.IntrinsicElements["p"];

		/** `<Field.Issue />` component props */
		export type Issue = JSX.IntrinsicElements["p"];

		/**
		 * `<Field.Control />` component props
		 *
		 * @template T Tag name
		 */
		export type Control<T extends Tag> = T extends "textarea"
			? JSX.IntrinsicElements["textarea"]
			: T extends "select"
				? JSX.IntrinsicElements["select"]
				: JSX.IntrinsicElements["input"];

		export namespace Control {
			/**
			 * `<Field.Control />` component props for group input element.
			 *
			 * @template T Tag name
			 * @template V Option values
			 */
			export type Group<T extends Tag, V extends Values> = Control<T> & {
				readonly value: V[number];
			};
		}

		/** `<Field.Label />` component props */
		export type Label = JSX.IntrinsicElements["label"];

		export namespace Label {
			/**
			 * `<Field.Label />` component props for group input element.
			 *
			 * @template V Option values
			 */
			export type Group<V extends Values> = Label & {
				readonly value: V[number];
			};
		}

		/**
		 * `<Field.Option />` select component props
		 *
		 * @template V Values
		 */
		export type Option<V extends Values> = JSX.IntrinsicElements["option"] & {
			/** Option value */
			readonly value: V[number];
		};

		export namespace Option {
			/**
			 * `<Field.Option />` input group component props
			 *
			 * Wrapper for both the `<Label />` and `<Input />` components.
			 *
			 * @template V Values
			 */
			export type Input<V extends Values> = JSX.IntrinsicElements["div"] & {
				/** Option value */
				readonly value: V[number];
			};
		}
	}

	/**
	 * Base Field component object that contains sub-components,
	 * use for fine grained rendering control.
	 *
	 * @template F Field
	 */
	export type Component<F extends Any> = Readonly<
		{
			/**
			 * @param props Description props
			 * @returns Description paragraph, nothing when the field has no description
			 */
			Description: (props?: Component.Description) => JSX.Element;

			/**
			 * @param props Issue props
			 * @returns Issue container paragraph
			 */
			Issue: (props?: Component.Issue) => JSX.Element;
		} & (F extends Instance<any, "select", Field.Type, infer V>
			? V extends Values
				? // select
					{
						/** Select option values */
						values: V;

						/**
						 * @param props Root props
						 * @returns Root container div
						 */
						Root: (props?: Component.Root) => JSX.Element;

						/**
						 * @param props Label props
						 * @returns Label element
						 */
						Label: (props?: Component.Label) => JSX.Element;

						/**
						 * @param props Control props
						 * @returns Control select element
						 */
						Control: (props?: Component.Control<"select">) => JSX.Element;

						/**
						 * @param props Option props
						 * @returns Select option element
						 */
						Option: (props: Component.Option<V>) => JSX.Element;
					}
				: never
			: F extends Instance<any, "input", Field.Type, infer V>
				? V extends Values
					? // radio/checkboxes
						{
							/** Input group values */
							values: V;

							/**
							 * @param props Root props
							 * @returns Root container fieldset
							 */
							Root: (props?: Component.Root.Group) => JSX.Element;

							/**
							 * @param props Legend element props
							 * @returns Legend element
							 */
							Legend: (props?: Component.Legend) => JSX.Element;

							/**
							 * @param props Label props including `value`
							 * @returns Label element
							 */
							Label: (props: Component.Label.Group<V>) => JSX.Element;

							/**
							 * @param props Control props
							 * @returns Control input element
							 */
							Control: (
								props?: Component.Control.Group<"input", V>,
							) => JSX.Element;

							/**
							 * @param props Option props
							 * @returns Both label and input elements together
							 */
							Option: (props: Component.Option.Input<V>) => JSX.Element;
						}
					: // regular input
						{
							/**
							 * @param props Root props
							 * @returns Root container div
							 */
							Root: (props?: Component.Root) => JSX.Element;

							/**
							 * @param props Label props
							 * @returns Label element
							 */
							Label: (props?: Component.Label) => JSX.Element;

							/**
							 * @param props Control props
							 * @returns Control input element
							 */
							Control: (props?: Component.Control<"input">) => JSX.Element;
						}
				: // textarea
					{
						/**
						 * @param props Root props
						 * @returns Root container div
						 */
						Root: (props?: Component.Root) => JSX.Element;

						/**
						 * @param props Label props
						 * @returns Label element
						 */
						Label: (props?: Component.Label) => JSX.Element;

						/**
						 * @param props Control props
						 * @returns Control textarea element
						 */
						Control: (props?: Component.Control<"textarea">) => JSX.Element;
					})
	>;

	/** Any field props */
	export type Props = Props.Input | Props.Select | Props.Textarea;

	export namespace Props {
		/**
		 * A field's label and description are what it means, for people and
		 * agents, and not attributes of its control: set them with `label()` and
		 * `describe()`, and the control's attributes with `control()`.
		 */
		interface Chained {
			/** Use `field.label(text)` */
			readonly label?: never;

			/** Use `field.describe(text)` */
			readonly description?: never;
		}

		/** Attributes of an `<input>` field's control */
		export type Input = JSX.IntrinsicElements["input"] & Chained;

		/** Attributes of a `<select>` field's control */
		export type Select = JSX.IntrinsicElements["select"] & Chained;

		/** Attributes of a `<textarea>` field's control */
		export type Textarea = JSX.IntrinsicElements["textarea"] & Chained;
	}
}

/** Field factory functions */
export class Field {
	// this is used instead of the defaults for example "Expected string"
	// since "string" doesn't make sense to end users
	/** Default message for required field values. */
	static readonly #required = "Required field";
	/**
	 * Message for choices, whether none or one not offered was sent, such as
	 * by an agent, where "Required field" would be wrong.
	 */
	static readonly #choose = "Select an option";

	/**
	 * @param value Raw form entry
	 * @returns `true` when the file input contains a real file value
	 */
	static #nonEmptyFile(value: FormDataEntryValue | null) {
		return value instanceof File && (value.name !== "" || value.size > 0);
	}

	/**
	 * @param data Form data
	 * @param name HTML name attribute
	 * @returns Field values or `undefined` when missing
	 */
	static #readMany(data: FormData | URLSearchParams, name: string) {
		const value = data.getAll(name);

		return value.length ? value : undefined;
	}

	/**
	 * @template T Input type
	 * @param props Input props
	 * @returns Generic input field
	 */
	static #input<T extends Field.Type>(
		props: Field.Props.Input & { type: T },
	): Field.Instance<string, "input", T> {
		return new FieldSchema({ props }, Schema.string(Field.#required));
	}

	/**
	 * @returns Text input field
	 */
	static text(): Field.Instance<string, "input", "text"> {
		return Field.#input({ type: "text" });
	}

	/**
	 * @returns Password input field
	 */
	static password(): Field.Instance<string, "input", "password"> {
		return Field.#input({ type: "password" });
	}

	/**
	 * @returns Search input field
	 */
	static search(): Field.Instance<string, "input", "search"> {
		return Field.#input({ type: "search" });
	}

	/**
	 * @returns Telephone input field
	 */
	static tel(): Field.Instance<string, "input", "tel"> {
		return Field.#input({ type: "tel" });
	}

	/**
	 * @returns Color input field
	 */
	static color(): Field.Instance<string, "input", "color"> {
		return Field.#input({ type: "color" });
	}

	/**
	 * @returns Hidden input field
	 */
	static hidden(): Field.Instance<string, "input", "hidden"> {
		return Field.#input({ type: "hidden" });
	}

	/**
	 * @returns Date input field
	 */
	static date(): Field.Instance<string, "input", "date"> {
		return Field.#input({ type: "date" });
	}

	/**
	 * @returns Datetime input field
	 */
	static datetime(): Field.Instance<string, "input", "datetime-local"> {
		return Field.#input({ type: "datetime-local" });
	}

	/**
	 * @returns Month input field
	 */
	static month(): Field.Instance<string, "input", "month"> {
		return Field.#input({ type: "month" });
	}

	/**
	 * @returns Week input field
	 */
	static week(): Field.Instance<string, "input", "week"> {
		return Field.#input({ type: "week" });
	}

	/**
	 * @returns Time input field
	 */
	static time(): Field.Instance<string, "input", "time"> {
		return Field.#input({ type: "time" });
	}

	/**
	 * Validates email string.
	 *
	 * @param message Issue message when invalid
	 * @returns Email input field
	 */
	static email(message?: string): Field.Instance<string, "input", "email"> {
		return Field.#input({ type: "email" }).email(message);
	}

	/**
	 * Validates parsable URL.
	 *
	 * @param message Issue message when invalid
	 * @returns URL input field
	 */
	static url(message?: string): Field.Instance<string, "input", "url"> {
		return Field.#input({ type: "url" }).url(message);
	}

	/**
	 * @template T Input type, `number` or `range`
	 * @param props Input props
	 * @returns Input field
	 */
	static #number<T extends "number" | "range">(
		props: Field.Props.Input & { type: T },
	): Field.Instance<number, "input", T> {
		// registered here rather than as the class loads, which is a side effect
		// that would keep `Field` in bundles that only use `Form`
		normalizers.add(Field.#toNumber);

		return new FieldSchema(
			{ props },
			Schema.number(Field.#required).preprocess(Field.#toNumber),
		);
	}

	/**
	 * @param value Form entry or stored number
	 * @returns The number to validate
	 */
	static #toNumber(value: unknown) {
		// form submissions read numeric controls as strings
		if (value == null || value === "") return undefined;

		return exact(value);
	}

	/**
	 * Coerces to number.
	 *
	 * @returns Number input field
	 */
	static number(): Field.Instance<number, "input", "number"> {
		return Field.#number({ type: "number" });
	}

	/**
	 * Coerces to number.
	 *
	 * @returns Range input field
	 */
	static range(): Field.Instance<number, "input", "range"> {
		return Field.#number({ type: "range" });
	}

	/**
	 * - unchecked => key missing => `false`
	 * - checked => key present => `true`
	 *
	 * @returns Checkbox input field
	 */
	static checkbox(): Field.Instance<boolean, "input", "checkbox"> {
		return new FieldSchema(
			{ props: { type: "checkbox" } },
			Schema.boolean(),
			(formData, name) => formData.has(name),
		);
	}

	/**
	 * @returns File input field
	 */
	static file(): Field.Instance<File, "input", "file"> {
		return new FieldSchema(
			{ props: { type: "file" } },
			Schema.instance(File, Field.#required),
			(data, name) => {
				const value = data.get(name);

				return (Field.#nonEmptyFile(value) && value) || undefined;
			},
		);
	}

	/**
	 * @returns Multiple file input field
	 */
	static files(): Field.Instance<File[], "input", "file"> {
		return new FieldSchema(
			{ props: { type: "file", multiple: true } },
			Schema.array(Schema.instance(File, Field.#required), Field.#required),
			(data, name) => {
				const value = data.getAll(name).filter(Field.#nonEmptyFile);

				return value.length ? value : undefined;
			},
			Infinity,
		);
	}

	/**
	 * @template V Value type
	 * @param values Checkbox values
	 * @returns Checkbox group input field
	 */
	static checkboxes<const V extends string>(
		values: readonly [V, ...V[]],
	): Field.Instance<V[], "input", "checkbox", readonly [V, ...V[]]> {
		return new FieldSchema(
			{ values, props: { type: "checkbox" } },
			Schema.array(Schema.enum(values, Field.#choose), Field.#choose),
			Field.#readMany,
			values.length,
		);
	}

	/**
	 * @template V Value type
	 * @param values Radio button values
	 * @returns Radio group input field
	 */
	static radio<const V extends string>(
		values: readonly [V, ...V[]],
	): Field.Instance<V, "input", "radio", readonly [V, ...V[]]> {
		return new FieldSchema(
			{ values, props: { type: "radio" } },
			Schema.enum(values, Field.#choose),
		);
	}

	/**
	 * @returns Textarea field
	 */
	static textarea(): Field.Instance<string, "textarea"> {
		return new FieldSchema({ tag: "textarea" }, Schema.string(Field.#required));
	}

	/**
	 * @template V Value type
	 * @param values Select options
	 * @returns Select field
	 */
	static select<const V extends string>(
		values: readonly [V, ...V[]],
	): Field.Instance<V, "select", Field.Type, readonly [V, ...V[]]> {
		return new FieldSchema(
			{ tag: "select", values },
			Schema.enum(values, Field.#choose),
		);
	}

	/**
	 * @template V Value type
	 * @param values Select options
	 * @returns Multi-select field
	 */
	static multiselect<const V extends string>(
		values: readonly [V, ...V[]],
	): Field.Instance<V[], "select", Field.Type, readonly [V, ...V[]]> {
		return new FieldSchema(
			{ tag: "select", values, props: { multiple: true } },
			Schema.array(Schema.enum(values, Field.#choose), Field.#choose),
			Field.#readMany,
			values.length,
		);
	}
}
