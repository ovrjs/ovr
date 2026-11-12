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
import { Checksum, Codec, Prose, Size, type Util } from "../util/index.js";

/** Internal protocol for a GET route, to make the form its fields render. */
export const query = Symbol("query");

/** Internal protocol for Auth, the message a `taken()` field shows */
export const taken = Symbol("taken");

/** A field's components and render, which a route's form reads */
const component = Symbol("component");
const render = Symbol("render");

/**
 * Each route's form, kept apart from the route so its parsing is not part of
 * the route's API.
 */
export const forms = new WeakMap<object, Form<any>>();

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
export class Form<Shape extends Field.Shape = Field.Shape> {
	/** Query param keys ordered as `[return, form]`. */
	static readonly params = ["_return", "_form"] as const;

	/** Maximum serialized size for a single persisted value. */
	static readonly #maxValueChars = 512;

	/** Schema used to validate persisted form values, see `#value`. */
	static #valueSchema?: Schema<Field.Value.Cell>;

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

	/** Names of the lists, whose cells are named by them. */
	readonly #lists: ShapeUtil.Name<Shape>[];

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
		this.#lists = this.names.filter((name) => this.shape[name]!.item);
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
	 * @param name Form data name
	 * @returns The field, own fields only, so a name such as "constructor" has
	 * none. A list's cell, such as `steps.0`, is its list's.
	 */
	#field(name: string) {
		if (Object.hasOwn(this.shape, name)) return this.shape[name];

		for (const list of this.#lists) {
			const field = this.shape[list]!;
			if (FieldSchema.place(field.item!, list, name) !== undefined)
				return field;
		}
	}

	/**
	 * @param item What each item of a list is
	 * @param value Candidate items
	 * @returns The items a list can render, without what a cell cannot
	 */
	static #items(item: Field.Item, value: unknown) {
		if (!Array.isArray(value)) return;

		const cell = (field: Field.Cell, value: unknown) => {
			if (field.type === "file" || field.type === "password" || value == null)
				return;

			const result = Form.#value().parse(value);
			if (!result.issues) return result.data;
		};

		return value.map((row: unknown) => {
			// a place is kept, so the items after it stay where they were
			if (field(item)) return cell(item, row) ?? "";

			const cells: Record<string, Field.Value.Cell> = {};
			if (row && typeof row === "object") {
				for (const key of Object.keys(item)) {
					const value = cell(item[key]!, (row as Record<string, unknown>)[key]);
					if (value !== undefined) own(cells, key, value);
				}
			}
			return cells;
		});
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
		const sanitized: Field.Value.Map<Shape> = {};

		if (values) {
			for (const [name, value] of Object.entries(values)) {
				const field = this.#field(name);

				if (
					field &&
					field.type !== "file" &&
					(!persist || FieldSchema.persisted(field)) &&
					value != null
				) {
					if (field.item) {
						// a cleared list is recorded empty, and no list has a size of
						// its own: the state's limit holds them all
						const items = value === "" ? [] : Form.#items(field.item, value);
						if (items) own(sanitized, name, items);
						continue;
					}

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
	 * An issue by place means nothing without the rows it was found in, and a
	 * list's rows are only shown again when it persists and they fit the state.
	 *
	 * @param state Restored state
	 * @returns The state, where an issue of a cell whose list's rows were not
	 * restored is the list's own, and says which row and field it is about
	 */
	#unplaced(state?: Field.State<Shape>): Field.State<Shape> | undefined {
		if (!state?.issues || !this.#lists.length) return state;

		return {
			...state,
			issues: state.issues.map((issue) => {
				const [name, place, key] = issue.path;
				if (
					typeof place !== "number" ||
					!this.#lists.includes(name as ShapeUtil.Name<Shape>) ||
					state.values?.[name as ShapeUtil.Name<Shape>] !== undefined
				)
					return issue;

				// the field as people know it, by its column's heading
				const { item } = this.shape[name as ShapeUtil.Name<Shape>]!;
				const cell =
					typeof key === "string" && !field(item) && Object.hasOwn(item!, key)
						? `, ${FieldSchema.named(item![key]!, key)}`
						: "";

				return new Schema.Issue(
					issue.expected,
					[name!],
					`Row ${place + 1}${cell}: ${issue.message}`,
				);
			}) as unknown as Schema.Issue.List,
		};
	}

	/**
	 * Decode form state, over the initial values.
	 *
	 * @param stateInput Current page URL
	 * @param initial Initial values, submitted values take precedence
	 */
	#decode(
		stateInput?: URL,
		initial?: Field.Value.Initial<Shape>,
	): Field.State<Shape> | undefined {
		const state = this.#unplaced(this.#restore(stateInput));
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
	#restore(stateInput?: URL): Field.State<Shape> | undefined {
		if (stateInput) {
			const { searchParams } = stateInput;
			const values = this.#sanitize(
				(this.#query ? this.names : []).reduce<Record<string, unknown>>(
					(data, name) => {
						// a list's cells are named by it, so its own name is not there
						if (searchParams.has(name) || this.shape[name]!.item) {
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
										own(
											shape,
											name,
											// a list's items are checked as they are sanitized
											this.shape[name]!.item
												? Schema.unknown()
												: Form.#value().optional(),
										);

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
						} as unknown as Field.State<Shape>;
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
		let search: Field.Parse.Result.Search;

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
				} satisfies Field.State),
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
	): Promise<Field.Parse.Result<Shape>> => {
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
			data: data as Field.Parse.Data<Shape>,
			stream,
			invalid: (messages: Field.Parse.Messages<Shape>) =>
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
		values?: Field.Value.Initial<Shape> | undefined;
	}) =>
		this.shape[props.name]![render]({
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
		values?: Field.Value.Initial<Shape> | undefined;
		/** Each field's own: give them to its `Field` or `component` */
		options?: never;
	} = {}) => {
		const state = this.#decode(props.state, values); // pulled out to not call each map iteration

		return this.names.map((name) =>
			this.shape[name]![render]({ ...props, name, state }),
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
			values?: Field.Value.Initial<Shape> | undefined;
		}): Field.Component<Shape[N]> =>
		this.shape[props.name]![component]({
			...props,
			state: this.#decode(props.state, values),
		});
}

/** Default message for a required field */
const required = "Required field";

/** Default message for a choice that is not one of the options */
const choose = "Select an option";

/** Default message for a number field sent a value that is not a number */
const numeric = "Enter a number";

/**
 * @param value Form data entry
 * @returns `true` for a file a person chose, a browser sends an empty one otherwise
 */
const chosenFile = (value: FormDataEntryValue | null): value is File =>
	value instanceof File && (value.name !== "" || value.size > 0);

/**
 * @param data Form data
 * @param name HTML name attribute
 * @returns Every value of the name, or `undefined` when there is none
 */
const readMany = (data: FormData | URLSearchParams, name: string) => {
	const value = data.getAll(name);

	return value.length ? value : undefined;
};

/**
 * Represents a form field with parsing logic and rendering metadata.
 *
 * @template Output Output type of the field
 * @template Tag Tag name
 * @template Type Input type
 * @template Values Persisted field value type
 * @template Stream If the field should be streamed as a part
 * @template Item What each item of a list is
 */
class FieldSchema<
	Output = unknown,
	Tag extends Field.Tag = "input",
	Type extends Field.Type = Field.Type,
	Values extends Field.Options | undefined = undefined,
	Stream extends boolean | undefined = undefined,
	Item extends Field.Item | undefined = undefined,
> extends Schema<Output> {
	/** Read the value from form data */
	readonly #read: Field.Read;

	/** Field type */
	readonly type: Type;

	// tag and options are public so emitted .d.ts preserves
	// field discriminants for correct types
	/** Field tag */
	readonly tag: Tag;

	/** Choices of a select, radio, or checkbox group */
	readonly options: Values;

	/** What each item of a list is: a field, or fields by name */
	readonly item: Item;

	/** Maximum expected multipart part count for this field name. */
	readonly parts: number;

	/** If the field should be streamed as a part */
	readonly streaming: Stream | undefined;

	/** If the field should persist invalid-state values. */
	readonly #persist: boolean;

	/** Field options */
	readonly #config: Field.Config<Values, Tag>;

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
		config: Field.Config<Values, Tag>,
		schema: Schema<Output> | Schema.Def,
		// default to a single value, treating blank as missing
		read: Field.Read = (data, name) => data.get(name) || undefined,
		parts = 1,
		stream?: Stream,
		persist = false,
	) {
		super(schema instanceof Schema ? schema.def : schema);

		this.#config = config;
		this.tag = (config.tag ?? "input") as Tag;
		this.options = config.options as Values;
		this.item = config.item as Item;
		this.#read = read;
		this.type = config.props?.type as Type;
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

	/** How each picker writes its value, a sentence so it reads alone too */
	static readonly #formats: Record<string, string | undefined> = {
		date: "Date as YYYY-MM-DD.",
		"datetime-local": "Date and time as YYYY-MM-DDTHH:mm.",
		month: "Month as YYYY-MM.",
		week: "Week as YYYY-Www, such as 2026-W46.",
		time: "Time as HH:mm.",
		color: "Color as #rrggbb.",
	};

	/**
	 * @internal The label people read, which names a terse field such as
	 * `dob`, and an unchecked box's default
	 * @param io Side of the description
	 * @returns Keywords added to the property's JSON Schema
	 */
	override [annotate](io: "input" | "output") {
		const { label } = this.#config;
		const { description } = this;
		// what a browser's picker sends, which a string alone does not say
		const format = FieldSchema.#formats[this.type as string];
		// what people call a choice, where it is not its value
		const named = Object.entries(this.#config.labels ?? {})
			.filter(([value, label]) => label !== value)
			.map(([value, label]) => `${value} (${label})`)
			.join(", ");
		const described = Prose.join(
			description,
			format,
			named && `Choices: ${named}.`,
		);

		return {
			...(label && { title: label }),
			...(described && { description: described }),
			...(this.type === "date" && { format: "date" }),
			// a browser leaves an unchecked box out and it reads as false, so
			// input, such as an agent's, may leave it out too
			...(io === "input" &&
				this.type === "checkbox" &&
				!this.options && { default: false }),
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
	 * @param item What each item of the list is
	 * @param list The list's name
	 * @param name Form data name
	 * @returns The place of the item the name is a cell of, such as 2 for
	 * `steps.2` or `ingredients.2.amount`, `undefined` for any other name
	 */
	static place(item: Field.Item, list: string, name: string) {
		if (!name.startsWith(`${list}.`)) return;

		const [, place, key] =
			/^(0|[1-9]\d{0,8})(?:\.(.+))?$/s.exec(name.slice(list.length + 1)) ?? [];

		if (
			place === undefined ||
			(item instanceof FieldSchema
				? key !== undefined
				: key === undefined || !Object.hasOwn(item, key))
		)
			return;

		return Number(place);
	}

	/**
	 * @param item What each item of the list is
	 * @returns How the list reads its items, in the order of their places. An
	 * item left empty is left out, so a person clears a row to remove it.
	 */
	static items(item: Field.Item): Field.Read {
		// a hidden cell, such as a row's ID, is sent with an empty row too
		const filled = (cell: Field.Cell, value: Field.Input) =>
			value !== undefined && value !== false && cell.type !== "hidden";

		return (data, name) => {
			const places = new Set<number>();
			for (const key of data.keys()) {
				const place = FieldSchema.place(item, name, key);
				if (place !== undefined) places.add(place);
			}

			const items: Field.Input.Cell[] | Record<string, Field.Input.Cell>[] = [];
			for (const place of [...places].sort((a, b) => a - b)) {
				const at = `${name}.${place}`;

				if (item instanceof FieldSchema) {
					const value = item.#read(data, at) as Field.Input.Cell;
					if (filled(item, value)) (items as Field.Input.Cell[]).push(value);
					continue;
				}

				const row: Record<string, Field.Input.Cell> = {};
				let any = false;
				for (const [key, cell] of Object.entries(item)) {
					const value = cell.#read(data, `${at}.${key}`) as Field.Input.Cell;
					if (filled(cell, value)) any = true;
					own(row, key, value);
				}
				if (any) (items as Record<string, Field.Input.Cell>[]).push(row);
			}

			return items.length ? items : undefined;
		};
	}

	/**
	 * Stream this field as a multipart request `Part`.
	 *
	 * @returns Part field
	 */
	stream(): Field.Instance<Output, Tag, Type, Values, true, Item> {
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
	label(text: string): Field.Instance<Output, Tag, Type, Values, Stream, Item> {
		return this.#with({ label: text });
	}

	/**
	 * What to say when a user already has the value, for a value no two users
	 * share and anyone may see, such as a username. Registration checks it
	 * before the passkey prompt and shows `message` on the field. Leave it off
	 * a private value, such as an email, so a conflict does not reveal who has
	 * an account. The unique constraint itself is the table's, in a migration.
	 *
	 * ```ts
	 * Field.text().taken("Someone already has this username");
	 * ```
	 *
	 * @template U Input type, one people read: not a password or file
	 * @param message What to show when a user already has the value
	 * @returns Field with the message
	 */
	taken<
		U extends (Tag extends "input" ? Exclude<Type, "password" | "file"> : Type),
	>(
		this: Field.Instance<Output, Tag, U, Values, Stream, Item>,
		message: string,
	): Field.Instance<Output, Tag, U, Values, Stream, Item>;
	taken(message: string) {
		return this.#with({ taken: message });
	}

	/** @internal The message `taken()` set */
	get [taken]() {
		return this.#config.taken;
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
				: Tag extends "fieldset"
					? // a list has no control of its own, each of its fields has one
						Field.Props.List
					: // the field is its type
						Field.Props.Input & { readonly type?: never },
	): Field.Instance<Output, Tag, Type, Values, Stream, Item> {
		return this.#with({
			props: { ...this.#config.props, ...attributes } as Field.Props,
		});
	}

	/**
	 * @param changes What to change
	 * @returns The same field with them
	 */
	#with(changes: Pick<Field.Config, "label" | "taken" | "props">) {
		return this.#copy({ config: { ...this.#config, ...changes } });
	}

	/**
	 * @template O Output type of the copy
	 * @template S If the copy streams as a part
	 * @param changes What the copy changes, the rest is this field's
	 * @returns A copy of this field
	 */
	#copy<O = Output, S extends boolean | undefined = Stream>({
		config = this.#config,
		def = this.def,
		stream = this.streaming as S,
		persist = this.#persist,
	}: {
		config?: Field.Config<Values, Tag>;
		def?: Schema.Def;
		stream?: S;
		persist?: boolean;
	}) {
		return new FieldSchema<O, Tag, Type, Values, S, Item>(
			config,
			def,
			this.#read,
			this.parts,
			stream,
			persist,
		);
	}

	/**
	 * Take more than one value: files, or options of a select. The value is
	 * an array, required to have one unless the field is made optional after.
	 *
	 * ```ts
	 * Field.file().multiple();
	 * Field.select(["red", "green", "blue"]).multiple();
	 * ```
	 *
	 * @returns Field whose value is an array
	 */
	multiple(
		this: Field.Instance<File, "input", "file", Values, Stream>,
	): Field.Instance<File[], "input", "file", Values, Stream>;
	multiple<V extends string>(
		this: Field.Instance<V, "select", Type, readonly [V, ...V[]], Stream>,
	): Field.Instance<V[], "select", Type, readonly [V, ...V[]], Stream>;
	// the overloads above are its types
	multiple(): any {
		const file = this.type === "file";
		const { description, ...def } = this.def;
		// each value is checked as this field checks one, and a description
		// given before describes the field, not each value
		const array = Schema.array(
			(description === undefined
				? this
				: this.#copy({ def })) as Schema<unknown>,
			file ? required : choose,
		);

		return new FieldSchema(
			{ ...this.#config, props: { ...this.#config.props, multiple: true } },
			description === undefined ? array : { ...array.def, description },
			file
				? (data, name) => {
						const files = data.getAll(name).filter(chosenFile);
						return files.length ? files : undefined;
					}
				: readMany,
			file ? Infinity : this.options!.length || Infinity,
			this.streaming,
			this.#persist,
		);
	}

	/**
	 * Take a textarea's lines as a list of text, such as steps or tags. People
	 * write one on each line, and agents send an array. Empty lines are left
	 * out, each line is checked as this field checks its text, and the list
	 * needs one line unless the field is made optional after.
	 *
	 * ```ts
	 * Field.textarea().lines(); // "Chop\nFry" and ["Chop", "Fry"] are ["Chop", "Fry"]
	 * Field.textarea().max(80).lines(); // each line at most 80 characters
	 * ```
	 *
	 * @returns Textarea field whose value is its lines
	 */
	lines(
		this: Field.Instance<string, "textarea", Type, Values, Stream>,
	): Field.Instance<string[], "textarea", Type, Values, Stream>;
	// the overload above is its type
	lines(): any {
		const { description, ...def } = this.def;
		// a description given before describes the field, not each line
		const array = Schema.array(
			(description === undefined
				? this
				: this.#copy({ def })) as Schema<unknown>,
			required,
		);

		return new FieldSchema(
			this.#config,
			description === undefined ? array : { ...array.def, description },
			(data, name) => {
				// a person's one value is split, an agent's array has one each
				const lines = data
					.getAll(name)
					.flatMap((value) =>
						typeof value === "string" ? value.split(/\r?\n/) : [],
					)
					.map((line) => line.trim())
					.filter(Boolean);

				return lines.length ? lines : undefined;
			},
			Infinity,
			this.streaming,
			this.#persist,
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
		this: Field.Instance<Output, Tag, U, Values, Stream, Item>,
	): Field.Instance<Output, Tag, U, Values, Stream, Item>;
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
	protected override derive<O>(
		def: Schema.Def,
	): Field.Instance<O, Tag, Type, Values, Stream, Item> {
		return this.#copy<O>({ def });
	}

	/**
	 * @param given Options given as the form renders
	 * @returns The field's own choices, those given for a field made from a
	 * schema, or `undefined` for a field without choices
	 */
	#options(given: Field.Component.Props<Field.Shape>["options"]) {
		const { options } = this;
		return (
			options &&
			(options.length
				? options
				: Array.isArray(given)
					? (given as readonly string[])
					: Object.keys(given ?? {}))
		);
	}

	/**
	 * @param given Options given as the form renders
	 * @returns What people call each choice: the field's own labels, or those
	 * given with the options of a field made from a schema
	 */
	#labels(given: Field.Component.Props<Field.Shape>["options"]) {
		const labels =
			this.#config.labels ??
			(this.options?.length || Array.isArray(given)
				? undefined
				: (given as Readonly<Record<string, string>> | undefined));

		// own labels only, so a value such as "constructor" is itself
		return (value: string) =>
			labels && Object.hasOwn(labels, value) ? labels[value]! : value;
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Field component with sub-components
	 */
	[component]<S extends Field.Shape>(
		props: Field.Component.Props<S, false>,
		named?: string,
		described?: boolean | string,
	): Field.Component<this>;
	[component]<S extends Field.Shape>(
		{ state, options: given, ...props }: Field.Component.Props<S, false>,
		// what a list calls its cell, which is named by its place
		named: string = props.name,
		// if the control is read with its description. A row laid out by
		// hand, such as in a table, seldom renders each cell's, and the
		// default table has one for the column, whose ID this is.
		described: boolean | string = true,
	): unknown {
		const options = this.#options(given);
		const text = this.#labels(given);
		const value = state?.values?.[props.name];
		const issue = state?.issues?.find(
			(i) =>
				i.path[0] === props.name &&
				// a list's own, each of its cells shows its own
				(!this.item || i.path.length === 1),
		);
		const issueId = issue && `${props.name}-issue`;
		const hidden = this.type === "hidden";
		const { label = named } = this.#config;
		const { description } = this;
		const descriptionId =
			description && !hidden ? `${props.name}-description` : undefined;
		const control = {
			id: hidden ? undefined : props.name,
			required: this.#required(),
			autofocus: issue && state?.issues?.[0] === issue,
			"aria-invalid": issue && "true",
			// read with the control: its description, then what is wrong with it
			"aria-describedby":
				[described === true ? descriptionId : described, issueId]
					.filter(Boolean)
					.join(" ") || undefined,
			...this.#config.props,
			...props,
		};

		/**
		 * @param option Option value
		 * @returns `true` when the value has the option
		 */
		const chosen = (option: string) =>
			Array.isArray(value)
				? (value as readonly unknown[]).includes(option) // checkboxes and multiselect
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

		if (this.item) {
			const cells = () => this.#cells({ state, options: given, ...props });
			// a list has no control of its own, so what is passed to it, such
			// as a class, is its fieldset's
			const { name: _, rows: __, ...attributes } = props;

			return {
				Description,
				Issue,
				Root: (data: Field.Component.Root.Group = {}) =>
					jsx("fieldset", { ...attributes, ...data }),
				Legend: (data: Field.Component.Legend = {}) =>
					jsx("legend", { children: label, ...data }),
				...this,
				// built when read, the default layout renders each cell itself
				get rows() {
					return cells().map((row) =>
						Array.isArray(row)
							? row[0][component](row[1], row[2], false)
							: Object.fromEntries(
									Object.entries(row).map(([key, cell]) => [
										key,
										cell[0][component](cell[1], cell[2], false),
									]),
								),
					);
				},
			};
		}

		if (options && this.tag !== "select") {
			// radio/checkboxes
			// make multiple ids for the group so all don't have the same id
			const groupId = (value: string) =>
				`${control.name}-${value}`.toLowerCase();

			const Control = (
				data: Field.Component.Control.Group<"input", Field.Options>,
			) =>
				jsx(this.tag, {
					...control,
					id: groupId(data.value),
					// autofocus only the first input in the group
					autofocus: control.autofocus && data.value === options[0],
					checked: chosen(data.value),
					...data,
				});

			const Label = ({
				value,
				...rest
			}: Field.Component.Label.Group<Field.Options>) =>
				jsx("label", { for: groupId(value), children: text(value), ...rest });

			return {
				Description,
				Issue,
				Label,
				Control,
				Root: (data: Field.Component.Root = {}) => jsx("fieldset", data),
				Option: ({
					value,
					...rest
				}: Field.Component.Option.Input<Field.Options>) =>
					jsx("div", {
						children: [Control({ value }), Label({ value })],
						...rest,
					}),
				Legend: (data: Field.Component.Legend = {}) =>
					jsx("legend", { children: label, ...data }),
				...this,
				options,
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
				// a select has none: it is the text of its empty choice
				if (this.tag === "select")
					delete (attrs as { placeholder?: unknown }).placeholder;

				if (value !== undefined) {
					if (this.tag === "textarea") {
						// each of its `lines()` on its own line
						attrs.children = Array.isArray(value) ? value.join("\n") : value;
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
				options &&
				((data: Field.Component.Option<Field.Options>) =>
					jsx("option", {
						children: text(data.value),
						selected: chosen(data.value),
						...data,
					})),
			...this,
			options,
		};
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props including `name` of the field to render
	 * @returns Component that renders the HTML field with default structure
	 */
	[render]<S extends Field.Shape>(
		props: Field.Component.Props<S, false>,
		named?: string,
	): JSX.Element {
		const { item } = this;
		// a list of several fields is a table, a column for each
		if (item && !(item instanceof FieldSchema)) return this.#table(props, item);

		const c = this[component](props, named) as unknown as Parts;

		return c.Root({
			children: [
				item
					? // a list of one field, a group with a legend, a row for each.
						// Its description is before the rows it explains, which
						// may be many.
						[
							c.Legend(),
							c.Description(),
							this.#cells(props).map((row) => {
								const [field, cell, named] = row as Placed;
								return field[render](cell, named);
							}),
						]
					: this.#grouped(props)
						? [c.Legend(), this.#body(c, props), c.Description()]
						: [c.Label(), this.#body(c, props), c.Description()],
				c.Issue(),
			],
		});
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns `true` for a radio or checkbox group
	 */
	#grouped<S extends Field.Shape>(props: Field.Component.Props<S, false>) {
		return Boolean(this.#options(props.options)) && this.tag !== "select";
	}

	/**
	 * @template S Form shape type
	 * @param c The field's parts
	 * @param props Field control props
	 * @returns The field's control: a group's boxes each with its label, or
	 * one control, a select with its options
	 */
	#body<S extends Field.Shape>(
		c: Parts,
		props: Field.Component.Props<S, false>,
	) {
		const options = this.#options(props.options);
		if (!options) return c.Control();

		if (this.tag !== "select")
			return options.map((value) =>
				jsx("div", { children: [c.Control({ value }), c.Label({ value })] }),
			);

		const placeholder =
			props.placeholder ??
			(this.#config.props as Field.Props.Select | undefined)?.placeholder;

		return c.Control({
			children: [
				// a browser chooses a select's first option, so one that may be
				// left empty, or that says what to choose, starts with an empty
				// choice
				(placeholder !== undefined || !(props.required ?? this.#required())) &&
					!this.#config.props?.multiple &&
					jsx("option", { value: "", children: placeholder }),
				options.map((value) => c.Option({ value })),
			],
		});
	}

	/**
	 * @template S Form shape type
	 * @param props The list's props
	 * @param item The fields of each item, by name
	 * @returns A list of several fields: a table with a column for each
	 * field, named in its heading and described once under the table, and a
	 * row for each item
	 */
	#table<S extends Field.Shape>(
		props: Field.Component.Props<S, false>,
		item: Readonly<Record<string, Field.Cell>>,
	) {
		const c = this[component](props) as unknown as Parts;
		const fields = Object.entries(item);
		const columns = fields.filter(([, field]) => field.type !== "hidden");
		const id = (key: string, part: string) => `${props.name}.${key}-${part}`;

		return c.Root({
			children: [
				c.Legend(),
				c.Description(),
				// an element of its own, so a wide table can scroll alone and the
				// text around it keeps the fieldset's width
				jsx("div", {
					children: jsx("table", {
						children: [
							jsx("thead", {
								children: jsx("tr", {
									children: columns.map(([key, field]) =>
										// only the label, which names each cell of the column
										jsx("th", {
											id: id(key, "label"),
											scope: "col",
											children: field.#config.label ?? key,
										}),
									),
								}),
							}),
							jsx("tbody", {
								children: this.#cells(props).map((cells) => {
									const row = cells as Readonly<Record<string, Placed>>;

									return jsx("tr", {
										children: columns.map(([key, field], column) => {
											const [, cell, named] = row[key]!;
											const group = field.#grouped(cell);
											const labelled = { "aria-labelledby": id(key, "label") };
											const parts = field[component](
												group ? cell : { ...cell, ...labelled },
												named,
												Boolean(field.description) && id(key, "description"),
											) as unknown as Parts;
											const body = field.#body(parts, cell);

											return jsx("td", {
												children: [
													// a row's hidden values, such as its ID
													!column &&
														fields.map(
															([key, field]) =>
																field.type === "hidden" &&
																field[render](row[key]![1], row[key]![2]),
														),
													group
														? jsx("div", {
																role: "group",
																...labelled,
																children: body,
															})
														: body,
													parts.Issue(),
												],
											});
										}),
									});
								}),
							}),
						],
					}),
				}),
				// what each column is, once under the table: a heading has no
				// room for it. Each cell of the column is read with its text.
				columns.map(
					([key, field]) =>
						field.description &&
						jsx("p", {
							"data-description": true,
							children: [
								jsx("span", { children: field.#config.label ?? key }),
								": ",
								jsx("span", {
									id: id(key, "description"),
									children: field.description,
								}),
							],
						}),
				),
				c.Issue(),
			],
		});
	}

	/**
	 * @returns The most items a list takes, set with `max()`
	 */
	#most() {
		let most = Infinity;

		for (
			let def: Schema.Def | undefined = this.def;
			def && "inner" in def;
			def = def.inner.def
		) {
			if (def.type === "check" && def.check.name === "max")
				most = Math.min(most, Math.floor(Number(def.check.value)));
		}

		return most;
	}

	/**
	 * @template S Form shape type
	 * @param props The list's props
	 * @returns Each row of the list: its filled items, then empty ones. A row is
	 * its cell, or its cells by name, each as the field, the props that render
	 * it, and what it is called.
	 */
	#cells<S extends Field.Shape>({
		state,
		rows,
		...props
	}: Field.Component.Props<S, false>) {
		const item = this.item as Field.Item;
		const { name } = props;
		// for this form, or wherever the list renders, set with `control()`
		const shown =
			rows ?? (this.#config.props as Field.Props.List | undefined)?.rows;
		const value = state?.values?.[name];
		const filled: unknown[] = Array.isArray(value) ? value : [];
		const values: Record<string, unknown> = {};

		filled.forEach((row, place) => {
			if (item instanceof FieldSchema) values[`${name}.${place}`] = row;
			else if (row && typeof row === "object")
				for (const key of Object.keys(item))
					values[`${name}.${place}.${key}`] = (row as Record<string, unknown>)[
						key
					];
		});

		// each cell finds its value and its issue by its own name
		const depth = item instanceof FieldSchema ? 2 : 3;
		const cells = {
			id: state?.id ?? "",
			values,
			issues: state?.issues?.map((issue) =>
				issue.path[0] === name && issue.path.length > 1
					? new Schema.Issue(
							issue.expected,
							[
								issue.path.slice(0, depth).join("."),
								...issue.path.slice(depth),
							],
							issue.message,
						)
					: issue,
			),
		} as unknown as Field.State<Field.Shape>;

		const cell = (field: Field.Cell, name: string, named: string) =>
			[
				field,
				// never required: a row left empty is left out. The list's own
				// attributes are its fieldset's, not each control's.
				{ name, state: cells, options: props.options, required: false },
				named,
			] as const;

		return Array.from(
			{
				// every filled row, and one more unless told how many to show,
				// but no more empty rows than the list takes
				length: Math.max(
					filled.length,
					Math.min(
						shown === undefined ? filled.length + 1 : Number(shown),
						this.#most(),
					),
				),
			},
			(_, place) =>
				item instanceof FieldSchema
					? cell(item, `${name}.${place}`, String(place + 1))
					: Object.fromEntries(
							Object.entries(item).map(([key, field]) => [
								key,
								cell(field, `${name}.${place}.${key}`, key),
							]),
						),
		);
	}

	/**
	 * @param field Field definition
	 * @param name The field's name
	 * @returns What people call the field: its label, or its name
	 */
	static named(field: Field.Any, name: string) {
		return field.#config.label ?? name;
	}

	/**
	 * @param field Field definition
	 * @returns `true` when the field persists invalid-state values
	 */
	static persisted(field: Field.Any) {
		return field.#persist;
	}
}

/** The parts of any kind of field, as its default layout uses them */
type Parts = {
	Root: (props?: Field.Component.Root) => JSX.Element;
	Legend: (props?: Field.Component.Legend) => JSX.Element;
	Label: (props?: { value?: string }) => JSX.Element;
	Control: (props?: { value?: string; children?: unknown }) => JSX.Element;
	Option: (props: Field.Component.Option<Field.Options>) => JSX.Element;
	Description: (props?: Field.Component.Description) => JSX.Element;
	Issue: (props?: Field.Component.Issue) => JSX.Element;
};

/** A cell of a list's row: its field, the props that render it, and its name */
type Placed = readonly [
	field: Field.Cell,
	props: Field.Component.Props<Field.Shape, false>,
	named: string,
];

/**
 * @param value Schema
 * @returns `true` for a form field, such as a table column made with `Field`
 */
export const field = (value: unknown): value is Field.Any =>
	value instanceof FieldSchema;

export namespace Field {
	/** Fields by name, as a route's `fields` takes them. */
	export type Shape = Record<string, Field.Any>;

	/** Persisted form value, a list's is its items */
	export type Value = Value.Cell | Value.Cell[] | Record<string, Value.Cell>[];

	export namespace Value {
		/** Value of one control, or of a cell of a list */
		export type Cell = string | number | boolean | string[];

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
			[K in keyof S]-?: S[K] extends Field.Instance<
				any,
				any,
				any,
				any,
				infer P,
				any
			>
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
			export type Search = [["_form", string]] | undefined;

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

	/**
	 * Base options to create a Field.
	 *
	 * @template V Choices of a select, radio, or checkbox group
	 * @template T Tag name
	 */
	export interface Config<
		V extends Options | undefined = undefined,
		T extends Tag = Tag,
	> {
		/**
		 * Tag name.
		 *
		 * @default "input"
		 */
		readonly tag?: T;

		/** Choices of a select, radio, or checkbox group */
		readonly options?: V;

		/** What people call each choice, by its value */
		readonly labels?: Readonly<Record<string, string>> | undefined;

		/** What people call the field, set with `label()` */
		readonly label?: string;

		/** What registration says when a user already has the value, set with `taken()` */
		readonly taken?: string;

		/** What each item of a list is */
		readonly item?: Item;

		/** Field props */
		readonly props?: Props | undefined;
	}

	/**
	 * Raw field value before schema parsing.
	 *
	 * Single-value fields read one entry, multi-value fields read all entries,
	 * checkboxes read presence, and lists read each item's cells.
	 */
	export type Input = Input.Cell | Input.Cell[] | Record<string, Input.Cell>[];

	export namespace Input {
		/** Raw value of one field, or of a cell of a list */
		export type Cell =
			FormDataEntryValue | FormDataEntryValue[] | boolean | undefined;
	}

	/**
	 * @param data FormData or URLSearchParams
	 * @param name HTML name attribute
	 * @returns Resolved value read from the form data
	 */
	export type Read = (data: FormData | URLSearchParams, name: string) => Input;

	/** Form field tag name, a list is a `fieldset` of its items */
	export type Tag = "input" | "textarea" | "select" | "fieldset";

	/** A field of a list's item: any but another list or a streamed field */
	export type Cell = Instance<
		any,
		Exclude<Tag, "fieldset">,
		Type,
		Options | undefined
	>;

	/** What each item of a list is: a field, or fields by name */
	export type Item = Cell | Readonly<Record<string, Cell>>;

	export namespace Item {
		/**
		 * Parsed value of an item.
		 *
		 * @template I Item
		 */
		export type Output<I extends Item> =
			I extends Schema<infer O>
				? O
				: I extends Schema.Object.Shape
					? Util.Prettify<Schema.Infer<I>>
					: never;
	}

	/** `<input type=...>` */
	export type Type = JSX.IntrinsicElements["input"]["type"];

	/** Value type for select and radio options */
	export type Options = readonly [string, ...string[]];

	/**
	 * Fixed choices of a select, radio, or checkbox group: the values, or what
	 * people call each one by its value, such as `{ crockpot: "Slow cooker" }`.
	 *
	 * @template V Value type
	 */
	export type Choices<V extends string> =
		readonly [V, ...V[]] | Readonly<Record<V, string>>;

	/**
	 * Field instance type
	 *
	 * @template Output Parsed value
	 * @template Tag Element tag
	 * @template Type Input type
	 * @template Values Options of a select, radio, or checkbox group
	 * @template Stream Whether the field streams as a multipart part
	 * @template Item What each item of a list is
	 */
	export type Instance<
		Output = unknown,
		Tag extends Field.Tag = "input",
		Type extends Field.Type = Field.Type,
		Values extends Field.Options | undefined = undefined,
		Stream extends boolean | undefined = undefined,
		Item extends Field.Item | undefined = undefined,
	> = FieldSchema<Output, Tag, Type, Values, Stream, Item>;

	/** Any field - `<input type=...>` / `<select>` / `<textarea>` / a list */
	export type Any = Instance<
		any,
		Tag,
		Type,
		Options | undefined,
		boolean | undefined,
		Item | undefined
	>;

	/**
	 * Obtain the tag name of a field.
	 *
	 * @template F Field
	 */
	export type TagOf<F extends Any> =
		F extends Instance<any, infer T, Field.Type, Field.Options | undefined>
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
		export type Props<S extends Field.Shape, I extends boolean = true> = {
			/** Field name attribute */
			readonly name: ShapeUtil.Name<S>;

			/**
			 * Choices of a checkbox group, radio group, or select made from a
			 * schema, such as `Field.checkboxes(Schema.string().uuid())`, known
			 * as the form renders: the values, each shown as it is, or what
			 * people call each one by its value, such as `{ [recipe.id]:
			 * recipe.title }`.
			 */
			readonly options?:
				readonly string[] | Readonly<Record<string, string>> | undefined;

			/**
			 * How many rows a list shows on this form, over what its
			 * `control({ rows })` set. Without either, a list shows its items and
			 * one empty row to add another. Every item is always shown, and no
			 * more rows than its `max()`.
			 */
			readonly rows?: number | undefined;

			/** Form state */
			readonly state?: (I extends true ? URL : Field.State<S>) | undefined;
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
			export type Group<T extends Tag, V extends Options> = Control<T> & {
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
			export type Group<V extends Options> = Label & {
				readonly value: V[number];
			};
		}

		/**
		 * `<Field.Option />` select component props
		 *
		 * @template V Options
		 */
		export type Option<V extends Options> = JSX.IntrinsicElements["option"] & {
			/** Option value */
			readonly value: V[number];
		};

		export namespace Option {
			/**
			 * `<Field.Option />` input group component props
			 *
			 * Wrapper for both the `<Label />` and `<Input />` components.
			 *
			 * @template V Options
			 */
			export type Input<V extends Options> = JSX.IntrinsicElements["div"] & {
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
		} & (F extends { readonly tag: "fieldset"; readonly item: infer I }
			? // list
				{
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
					 * The list's rows, its items and then the empty ones: each is
					 * its field's component, or its fields' components by name
					 */
					rows: readonly (I extends Cell
						? Component<I>
						: { readonly [K in keyof I]: Component<Extract<I[K], Cell>> })[];
				}
			: F extends Instance<any, "select", Field.Type, infer V>
				? V extends Options
					? // select
						{
							/** The select's options */
							options: V;

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
					? V extends Options
						? // radio/checkboxes
							{
								/** The group's options */
								options: V;

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
		export type Select = JSX.IntrinsicElements["select"] &
			Chained & {
				/**
				 * Text of the select's empty first choice, such as "Any meal". A
				 * select that must be chosen has the choice too when this is
				 * set, and the browser asks for another.
				 */
				readonly placeholder?: string | undefined;
			};

		/** Attributes of a `<textarea>` field's control */
		export type Textarea = JSX.IntrinsicElements["textarea"] & Chained;

		/** What a list takes in place of a control's attributes */
		export type List = {
			/**
			 * How many rows the list shows. Without it, a list shows its items
			 * and one empty row to add another. Every item is always shown, and
			 * no more rows than its `max()`.
			 */
			readonly rows?: number | undefined;
		};
	}
}

/** Field factory functions */
export class Field {
	// this is used instead of the defaults for example "Expected string"
	// since "string" doesn't make sense to end users

	/**
	 * @template T Input type
	 * @param props Input props
	 * @returns Generic input field
	 */
	static #input<T extends Field.Type>(
		props: Field.Props.Input & { type: T },
	): Field.Instance<string, "input", T> {
		return new FieldSchema({ props }, Schema.string(required));
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

		return new FieldSchema<number, "input", T>(
			{ props },
			// text, such as an agent's, is not a field left empty
			{ type: "number", message: numeric, missing: required },
		).preprocess(Field.#toNumber);
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
			Schema.instance(File, required),
			(data, name) => {
				const value = data.get(name);

				return (chosenFile(value) && value) || undefined;
			},
		);
	}

	/**
	 * @param options The choices, or a schema that checks each one when they
	 * are only known as the form renders, such as a record's own IDs
	 * @returns Fixed choices, and the schema that checks one, when given a list
	 */
	static #choices<V extends string>(
		options: Field.Choices<V> | Schema<V>,
	): Pick<Field.Config<readonly [V, ...V[]]>, "options" | "labels"> & {
		choice: Schema<V>;
	} {
		// given to `Field` or `component` as the form renders
		if (options instanceof Schema)
			return {
				options: [] as unknown as readonly [V, ...V[]],
				choice: options,
			};

		const labels = Array.isArray(options)
			? undefined
			: (options as Readonly<Record<V, string>>);
		const values = (labels ? Object.keys(labels) : options) as unknown as [
			V,
			...V[],
		];

		return { options: values, labels, choice: Schema.enum(values, choose) };
	}

	/**
	 * A group of checkboxes, of fixed choices or of choices a schema checks,
	 * which are given as the form renders:
	 *
	 * ```tsx
	 * Field.checkboxes(["fall", "winter"]);
	 * Field.checkboxes(Schema.string().uuid()); // <form.Field name="photos" options={ids} />
	 * ```
	 *
	 * @template V Value type
	 * @param options Checkbox options, or a schema for each one
	 * @returns Checkbox group input field
	 */
	static checkboxes<const V extends string>(
		options: Field.Choices<V> | Schema<V>,
	): Field.Instance<V[], "input", "checkbox", readonly [V, ...V[]]> {
		const { choice, ...config } = Field.#choices(options);

		return new FieldSchema(
			{ ...config, props: { type: "checkbox" } },
			Schema.array(choice, choose),
			readMany,
			config.options!.length || Infinity,
		);
	}

	/**
	 * @template V Value type
	 * @param options Radio button options, or a schema for the one chosen
	 * @returns Radio group input field
	 */
	static radio<const V extends string>(
		options: Field.Choices<V> | Schema<V>,
	): Field.Instance<V, "input", "radio", readonly [V, ...V[]]> {
		const { choice, ...config } = Field.#choices(options);

		return new FieldSchema({ ...config, props: { type: "radio" } }, choice);
	}

	/**
	 * @returns Textarea field
	 */
	static textarea(): Field.Instance<string, "textarea"> {
		return new FieldSchema({ tag: "textarea" }, Schema.string(required));
	}

	/**
	 * A list of items in order, where an item may repeat: each is one field,
	 * or several by name. People fill a row for each item, and agents send an
	 * array. A row left empty is left out, and the list needs one item unless
	 * the field is made optional after. `min()` and `max()` count its items.
	 *
	 * ```tsx
	 * Field.list(Field.select(Schema.string().uuid())); // string[]
	 * Field.list({ amount: Field.number(), name: Field.text() }); // { amount, name }[]
	 * Field.list(Field.select(id)).max(7).control({ rows: 7 }); // a week's dinners
	 * ```
	 *
	 * @template I Item type
	 * @param item What each item is: a field, or fields by name
	 * @returns List field whose value is an array of its items
	 */
	static list<I extends Field.Item>(
		item: I,
	): Field.Instance<
		Field.Item.Output<I>[],
		"fieldset",
		Field.Type,
		undefined,
		undefined,
		I
	> {
		return new FieldSchema(
			{ tag: "fieldset", item },
			Schema.array(
				field(item)
					? item
					: Schema.object(item as Readonly<Record<string, Field.Cell>>),
				required,
			),
			FieldSchema.items(item),
			Infinity,
		);
	}

	/**
	 * @template V Value type
	 * @param options Select options, or a schema for the one chosen
	 * @returns Select field
	 */
	static select<const V extends string>(
		options: Field.Choices<V> | Schema<V>,
	): Field.Instance<V, "select", Field.Type, readonly [V, ...V[]]> {
		const { choice, ...config } = Field.#choices(options);

		return new FieldSchema({ ...config, tag: "select" }, choice);
	}
}
