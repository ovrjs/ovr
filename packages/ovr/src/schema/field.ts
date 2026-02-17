import { type JSX, jsx } from "../jsx/index.js";
import { Schema } from "./index.js";

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

		/** Field props */
		readonly props?: Props;
	}

	/**
	 * @param data Form data
	 * @param name HTML name attribute
	 * @returns Resolved value read from the form data
	 */
	export type Read = (data: FormData, name: string) => unknown;

	/** Form field tag name */
	export type Tag = "input" | "textarea" | "select";

	/** `<input type=...>` */
	export type Type = JSX.IntrinsicElements["input"]["type"];

	/** Value type for select and radio options */
	export type Values = readonly [string, ...string[]];

	/** Any field - `<input type=...>` / `<select>` / `<textarea>` */
	export type Any = Field<unknown, Tag, Type, Values | undefined>;

	/**
	 * Obtain the tag name of a field.
	 *
	 * @template F Field
	 */
	export type TagOf<F extends Any> =
		F extends Field<unknown, infer T, Field.Type, Field.Values | undefined>
			? T
			: Tag;

	export namespace Component {
		/**
		 * Component props available to users to pass into the
		 * constructed `<Field />` component.
		 *
		 * @template S Form shape type
		 * @template I `true` the state is a `State.Input`, `false` is just `State`
		 */
		export type Props<S extends Schema.Form.Shape, I extends boolean = true> = {
			/** Field name attribute */
			readonly name: Schema.Form.Name<S>;

			/** Form state */
			readonly state?: I extends true
				? Schema.Form.State.Input<S>
				: Schema.Form.State<S>;
		} & Field.Props;

		/** Root element for the Field component */
		export type Root = JSX.IntrinsicElements["div"];

		export namespace Root {
			/** Root for input groups */
			export type Group = JSX.IntrinsicElements["fieldset"];
		}

		/** `<Field.Legend />` component props */
		export type Legend = JSX.IntrinsicElements["legend"];

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
			export type Group<T extends Tag, V extends Values> = Control<T> & {
				readonly value: V[number];
			};
		}

		/** `<Field.Label />` component props */
		export type Label = JSX.IntrinsicElements["label"];

		export namespace Label {
			/** `<Field.Label />` component props for group input element */
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
			 * @param props Issue props
			 * @returns Issue container paragraph
			 */
			Issue: (props?: Component.Issue) => JSX.Element;
		} & (F extends Field<unknown, "select", Field.Type, infer V>
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
			: F extends Field<unknown, "input", Field.Type, infer V>
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
		/** Extra props in addition to HTML attributes */
		interface Meta {
			/** Field label */
			readonly label?: string;
		}

		/** Props for `<input>` fields */
		export type Input = Meta & JSX.IntrinsicElements["input"];

		/** Props for `<select>` fields */
		export type Select = Meta & JSX.IntrinsicElements["select"];

		/** Props for `<textarea>` fields */
		export type Textarea = Meta & JSX.IntrinsicElements["textarea"];
	}
}

/**
 * Represents a form field with parsing logic and rendering metadata.
 *
 * @template Output Output type of the field
 * @template Tag Tag name
 * @template Type Input type
 * @template Values Persisted field value type
 */
export class Field<
	Output = unknown,
	Tag extends Field.Tag = "input",
	Type extends Field.Type = Field.Type,
	Values extends Field.Values | undefined = undefined,
> extends Schema<Output> {
	/** Read the value from form data */
	readonly read: Field.Read;

	/** Field type */
	readonly type: Type;

	/** Field options */
	readonly #options: Field.Options<Values, Tag>;

	/** Field tag */
	readonly #tag: Tag;

	/** Field values */
	readonly #values: Values;

	/**
	 * Create a new field.
	 *
	 * @param options Field  options
	 * @param parse How to validate the input
	 * @param read How to read the data from `FormData`
	 */
	constructor(
		options: Field.Options<Values, Tag>,
		parse: Schema<Output> | Schema.Parse.Constructor<Output>,
		read?: Field.Read,
	) {
		super(parse instanceof Schema ? parse.parse : parse);

		this.#options = options;
		this.#tag = (options.tag ?? "input") as Tag;
		this.#values = options.values as Values;

		this.read =
			read ??
			// default to FormData.get
			((data, name) => {
				const v = data.get(name);
				return v == null ? undefined : v;
			});

		this.type = options.props?.type as Type;
	}

	/**
	 * Derive a new Field from the current instance type.
	 *
	 * @template O Output type of the new Field
	 * @param parse Parse function that validates and transforms input
	 * @returns New `Field` instance
	 */
	override derive<O>(parse: Schema.Parse.Constructor<O>) {
		return new Field<O, Tag, Type, Values>(this.#options, parse, this.read);
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Field component with sub-components
	 */
	Component<const S extends Schema.Form.Shape>(
		props: Field.Component.Props<S, false>,
	): Field.Component<this>;
	Component<const S extends Schema.Form.Shape>({
		state,
		...props
	}: Field.Component.Props<S, false>): unknown {
		const value = state?.values?.[props.name];
		const issue = state?.issues?.find((i) => i.path[0] === props.name);
		const issueId = issue && `${props.name}-issue`;

		const control = {
			id: props.name,
			autocomplete: "on",
			autofocus: issue?.path[0] === props.name, // first issue
			"aria-invalid": issue && "true",
			"aria-describedby": issueId,
			...this.#options.props,
			...props,
		};

		const Issue = (data: Field.Component.Issue = {}) =>
			issue && // render nothing if no issue
			jsx("p", {
				id: issueId,
				children: issue.message,
				"data-issue": issue && state!.issues!.indexOf(issue), // issue index starting from 0
				...data,
			});

		if (this.#values && this.#tag !== "select") {
			// radio/checkboxes
			// make multiple ids for the group so all don't have the same id
			const groupId = (value: string) =>
				`${control.name}-${value}`.toLowerCase();

			const Control = (
				data: Field.Component.Control.Group<"input", Field.Values>,
			) =>
				jsx(this.#tag, {
					...control,
					id: groupId(data.value),
					// autofocus only the first input in the group
					autofocus: control.autofocus && data.value === this.#values?.[0],
					checked: Array.isArray(value)
						? value.includes(data.value) // checkboxes
						: value === data.value, // radio
					...data,
				});

			const Label = ({
				value,
				...rest
			}: Field.Component.Label.Group<Field.Values>) =>
				jsx("label", { for: groupId(value), children: value, ...rest });

			return {
				Issue,
				Label,
				Control,
				Root: (data: Field.Component.Root = {}) => jsx("fieldset", data),
				Option: (data: Field.Component.Option.Input<Field.Values>) =>
					jsx("div", {
						children: [
							Control({ value: data.value }),
							Label({ value: data.value }),
						],
						...data,
					}),
				Legend: (data: Field.Component.Legend = {}) =>
					jsx("legend", { children: control.name, ...data }),
				...this,
			};
		}

		return {
			Issue,
			Root: (data: Field.Component.Root = {}) => jsx("div", data),
			Label: (data: Field.Component.Label = {}) =>
				jsx("label", { for: control.id, children: control.name, ...data }),
			Control: (data?: Field.Component.Control<Tag>) => {
				const attrs = { ...control, ...data };

				if (value !== undefined) {
					if (this.#tag === "textarea") {
						attrs.children = value;
					} else if (this.#tag === "input") {
						if (this.type === "checkbox") {
							attrs.checked = value;
						} else {
							attrs.value = value;
						}
					}
				}

				return jsx(this.#tag, attrs);
			},
			Option:
				// select
				this.#values &&
				((data: Field.Component.Option<Field.Values>) =>
					jsx("option", {
						children: data.value,
						selected: Array.isArray(value)
							? value.includes(data.value) // multiselect
							: value === data.value,
						...data,
					})),
			...this,
		};
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Input group component
	 */
	#Group<const S extends Schema.Form.Shape>(
		this: Field<Output, "input", "radio" | "checkbox", Field.Values>,
		props: Field.Component.Props<S, false>,
	) {
		const Base = this.Component(props);

		return Base.Root({
			children: [
				jsx("legend", { children: props.name }),
				this.#values.map((value: string) => {
					return jsx("div", {
						children: [Base.Control({ value }), Base.Label({ value })],
					});
				}),
				Base.Issue(),
			],
		});
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Select component
	 */
	#Select<const S extends Schema.Form.Shape>(
		this: Field<Output, "select", Type, Field.Values>,
		props: Field.Component.Props<S, false>,
	) {
		const Base = this.Component(props);

		return Base.Root({
			children: [
				Base.Label(),
				Base.Control({
					children: this.#values.map((value: string) => Base.Option({ value })),
				}),
				Base.Issue(),
			],
		});
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props
	 * @returns Default input component
	 */
	#Input<const S extends Schema.Form.Shape>(
		props: Field.Component.Props<S, false>,
	) {
		const Base = this.Component(props);

		return Base.Root({
			children: [Base.Label(), Base.Control(), Base.Issue()],
		});
	}

	/**
	 * @template S Form shape type
	 * @param props Field control props including `name` of the field to render
	 * @returns Component that renders the HTML field with default structure
	 */
	Field<const S extends Schema.Form.Shape>(
		props: Field.Component.Props<S, false>,
	) {
		if (this.#values) {
			if (this.#tag === "select") return this.#Select(props);

			return this.#Group(props);
		}

		return this.#Input(props);
	}
}
