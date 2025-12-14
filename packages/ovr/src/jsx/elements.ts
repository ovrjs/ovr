// cspell: disable
import type { JSX } from "./index.js";

// https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes
/**
 * HTML Attributes
 *
 * @template P Additional props
 * @template Children For void elements - `undefined` is passed in here
 */
type Attributes<
	P extends JSX.Props = JSX.Props,
	Children = JSX.Element,
> = Partial<{
	children: Children;
	accesskey: string;
	anchor: string;
	autocapitalize: "on" | "off" | "characters" | "words" | "sentences";
	autocorrect: "on" | "off";
	autofocus: boolean;
	class: string;
	contenteditable: string;
	dir: string;
	draggable: boolean;
	enterkeyhint: string;
	exportparts: string;
	hidden: boolean;
	id: string;
	inert: boolean;
	inputmode: string;
	is: string;
	itemid: string;
	itemprop: string;
	itemref: string;
	itemscope: boolean;
	itemtype: string;
	lang: string;
	nonce: string;
	part: string;
	popover: boolean | "auto" | "hint" | "manual";
	// https://www.w3.org/TR/wai-aria-1.1/#role_definitions
	role:
		| "alert"
		| "alertdialog"
		| "application"
		| "article"
		| "banner"
		| "button"
		| "cell"
		| "checkbox"
		| "columnheader"
		| "combobox"
		| "complementary"
		| "contentinfo"
		| "definition"
		| "dialog"
		| "directory"
		| "document"
		| "feed"
		| "figure"
		| "form"
		| "grid"
		| "gridcell"
		| "group"
		| "heading"
		| "img"
		| "link"
		| "list"
		| "listbox"
		| "listitem"
		| "log"
		| "main"
		| "marquee"
		| "math"
		| "menu"
		| "menubar"
		| "menuitem"
		| "menuitemcheckbox"
		| "menuitemradio"
		| "navigation"
		| "none"
		| "note"
		| "option"
		| "presentation"
		| "progressbar"
		| "radio"
		| "radiogroup"
		| "region"
		| "row"
		| "rowgroup"
		| "rowheader"
		| "scrollbar"
		| "search"
		| "searchbox"
		| "separator"
		| "slider"
		| "spinbutton"
		| "status"
		| "switch"
		| "tab"
		| "table"
		| "tablist"
		| "tabpanel"
		| "term"
		| "textbox"
		| "timer"
		| "toolbar"
		| "tooltip"
		| "tree"
		| "treegrid"
		| "treeitem";
	slot: string;
	spellcheck: "true" | "false";
	style: string;
	tabindex: string | number;
	title: string;
	translate: string;
	virtualkeyboardpolicy: string;
	writingsuggestions: boolean;
	"aria-atomic": "true" | "false";
	"aria-busy": "true" | "false";
	"aria-controls": string;
	"aria-current":
		| "page"
		| "step"
		| "location"
		| "date"
		| "time"
		| "true"
		| "false";
	"aria-describedby": string;
	"aria-description": string;
	"aria-details": string;
	"aria-disabled": "true" | "false";
	"aria-dropeffect": "none" | "copy" | "execute" | "link" | "move" | "popup";
	"aria-errormessage": string;
	"aria-flowto": string;
	"aria-grabbed": "true" | "false";
	"aria-haspopup":
		| "menu"
		| "listbox"
		| "tree"
		| "grid"
		| "dialog"
		| "true"
		| "false";
	"aria-hidden": "true" | "false";
	"aria-invalid": "grammar" | "false" | "spelling" | "true";
	"aria-keyshortcuts": string;
	"aria-label": string;
	"aria-labelledby": string;
	"aria-live": "assertive" | "off" | "polite";
	"aria-owns": string;
	"aria-relevant": "additions" | "all" | "removals" | "text" | "additions text";
	"aria-roledescription": string;
}> &
	JSX.Props &
	Partial<P>;

// have lots of values and shared by some elements but not global
type SharedAttributes = {
	autocomplete:
		| "on"
		| "off"
		// https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete#token-list
		| (string & {});
	blocking: "render";
	controlslist:
		| "nodownload"
		| "nofullscreen"
		| "noremoteplayback"
		// allows multiple
		| (string & {});
	crossorigin: boolean | "anonymous" | "use-credentials";
	enctype:
		| "application/x-www-form-urlencoded"
		| "multipart/form-data"
		| "text/plain";
	fetchpriority: "high" | "low" | "auto";
	loading: "eager" | "lazy";
	method: "get" | "post" | "dialog";
	popovertargetaction: "hide" | "show" | "toggle";
	preload: "none" | "metadata" | "auto";
	referrerpolicy:
		| "no-referrer"
		| "no-referrer-when-downgrade"
		| "origin"
		| "origin-when-cross-origin"
		| "same-origin"
		| "strict-origin"
		| "strict-origin-when-cross-origin"
		| "unsafe-url";
	target: "_self" | "_blank" | "_parent" | "_top";
};

type AAttributes = Attributes<{
	download: string | boolean;
	href: string;
	hreflang: string;
	ping: string;
	referrerpolicy: SharedAttributes["referrerpolicy"];
	rel:
		| "alternate"
		| "author"
		| "bookmark"
		| "external"
		| "help"
		| "license"
		| "me"
		| "next"
		| "nofollow"
		| "noopener"
		| "noreferrer"
		| "opener"
		| "prev"
		| "privacy-policy"
		| "search"
		| "tag"
		| "terms-of-service"
		// allows multiple
		| (string & {});
	target: SharedAttributes["target"];
	type: string;
}>;

type AreaAttributes = Attributes<
	{
		alt: string;
		coords: "rect" | "circle" | "poly";
		download: string | boolean;
		href: string;
		ping: string;
		referrerpolicy: SharedAttributes["referrerpolicy"];
		rel: AAttributes["rel"];
		shape: "rect" | "circle" | "poly" | "default";
		target: SharedAttributes["target"];
	},
	never
>;

type AudioAttributes = Attributes<{
	autoplay: boolean;
	controls: boolean;
	controlslist: SharedAttributes["controlslist"];
	crossorigin: SharedAttributes["crossorigin"];
	disableremoteplayback: boolean;
	loop: boolean;
	muted: boolean;
	preload: SharedAttributes["preload"];
	src: string;
}>;

type BaseAttributes = Attributes<
	{ href: string; target: SharedAttributes["target"] },
	undefined
>;

type BlockquoteAttributes = Attributes<{ cite: string }>;

type BodyAttributes = Attributes<{
	onafterprint: string;
	onbeforeprint: string;
	onbeforeunload: string;
	onblur: string;
	onerror: string;
	onfocus: string;
	onhashchange: string;
	onlanguagechange: string;
	onload: string;
	onmessage: string;
	onmessageerror: string;
	onoffline: string;
	ononline: string;
	onpageswap: string;
	onpagehide: string;
	onpagereveal: string;
	onpageshow: string;
	onpopstate: string;
	onresize: string;
	onrejectionhandled: string;
	onstorage: string;
	onunhandledrejection: string;
	onunload: string;
}>;

type ButtonAttributes = Attributes<{
	command:
		| "show-modal"
		| "close"
		| "request-close"
		| "show-popover"
		| "hide-popover"
		| "toggle-popover"
		| (string & {});
	commandfor: string;
	disabled: boolean;
	form: string;
	formaction: string;
	formenctype: SharedAttributes["enctype"];
	formmethod: SharedAttributes["method"];
	formnovalidate: boolean;
	formtarget: SharedAttributes["target"];
	name: string;
	popovertarget: string;
	popovertargetaction: SharedAttributes["popovertargetaction"];
	type: "button" | "submit" | "reset";
	value: string;
}>;

type CanvasAttributes = Attributes<{
	height: string | number;
	["moz-opaque"]: boolean;
	width: string | number;
}>;

type ColAttributes = Attributes<{ span: string | number }, undefined>;

type ColgroupAttributes = Attributes<{ span: string | number }>;

type DataAttributes = Attributes<{ value: string }>;

type DelAttributes = Attributes<{ cite: string; datetime: string }>;

type DetailsAttributes = Attributes<{ open: boolean; name: string }>;

type DialogAttributes = Attributes<{
	closedby: "any" | "closerequest" | "none";
	open: boolean;
}>;

type EmbedAttributes = Attributes<
	{
		height: string | number;
		src: string;
		type: string;
		width: string | number;
	},
	undefined
>;

type FieldsetAttributes = Attributes<{
	disabled: boolean;
	form: string;
	name: string;
}>;

type FormAttributes = Attributes<{
	["accept-charset"]: string;
	autocomplete: SharedAttributes["autocomplete"];
	name: string;
	rel:
		| "external"
		| "help"
		| "license"
		| "next"
		| "nofollow"
		| "noopener"
		| "noreferrer"
		| "opener"
		| "prev"
		| "search";
	action: string;
	enctype: SharedAttributes["enctype"];
	method: SharedAttributes["method"];
	novalidate: boolean;
	target: SharedAttributes["target"];
}>;

type HtmlAttributes = Attributes<{ xmlns: string }>;

type IframeAttributes = Attributes<{
	allow: string;
	allowfullscreen: boolean;
	height: string | number;
	loading: SharedAttributes["loading"];
	name: string;
	referrerpolicy: SharedAttributes["referrerpolicy"];
	sandbox: string;
	src: string;
	srcdoc: string;
	width: string | number;
}>;

type ImgAttributes = Attributes<
	{
		alt: string;
		crossorigin: SharedAttributes["crossorigin"];
		decoding: "sync" | "async" | "auto";
		elementtiming: string;
		fetchpriority: SharedAttributes["fetchpriority"];
		height: string | number;
		ismap: boolean;
		loading: SharedAttributes["loading"];
		referrerpolicy: SharedAttributes["referrerpolicy"];
		sizes: string;
		src: string;
		srcset: string;
		width: string | number;
		usemap: string;
	},
	undefined
>;

type InputAttributes = Attributes<
	{
		accept: string;
		alt: string;
		autocomplete: SharedAttributes["autocomplete"];
		capture: string;
		checked: boolean;
		dirname: string;
		disabled: boolean;
		form: string;
		formaction: string;
		formenctype: SharedAttributes["enctype"];
		formmethod: SharedAttributes["method"];
		formnovalidate: boolean;
		formtarget: SharedAttributes["target"];
		height: string;
		list: string;
		max: string | number;
		maxlength: string | number;
		min: string | number;
		minlength: string | number;
		multiple: boolean;
		name: string;
		pattern: string;
		placeholder: string;
		popovertarget: string;
		popovertargetaction: SharedAttributes["popovertargetaction"];
		readonly: boolean;
		required: boolean;
		size: string | number;
		src: string;
		step: string | number;
		type:
			| "button"
			| "checkbox"
			| "color"
			| "date"
			| "datetime-local"
			| "email"
			| "file"
			| "hidden"
			| "image"
			| "month"
			| "number"
			| "password"
			| "radio"
			| "range"
			| "reset"
			| "search"
			| "submit"
			| "tel"
			| "text"
			| "time"
			| "url"
			| "week";
		value: string | number;
		webkitdirectory: boolean;
		width: string;
	},
	never
>;

type InsAttributes = Attributes<{ cite: string; datetime: string }>;

type LabelAttributes = Attributes<{ for: string }>;

type LiAttributes = Attributes<{ value: string | number }>;

type LinkAttributes = Attributes<{
	as:
		| "audio"
		| "document"
		| "embed"
		| "fetch"
		| "font"
		| "image"
		| "object"
		| "script"
		| "style"
		| "track"
		| "video"
		| "worker";
	blocking: SharedAttributes["blocking"];
	crossorigin: SharedAttributes["crossorigin"];
	disabled: boolean;
	fetchpriority: SharedAttributes["fetchpriority"];
	href: string;
	hreflang: string;
	imagesizes: string;
	imagesrcset: string;
	integrity: string;
	media: string;
	// not all the same options as others
	referrerpolicy:
		| "no-referrer"
		| "no-referrer-when-downgrade"
		| "origin"
		| "origin-when-cross-origin"
		| "unsafe-url";
	// not all the same options as others
	rel:
		| "alternate"
		| "author"
		| "canonical"
		| "dns-prefetch"
		| "expect"
		| "help"
		| "icon"
		| "license"
		| "manifest"
		| "me"
		| "modulepreload"
		| "next"
		| "pingback"
		| "preconnect"
		| "prefetch"
		| "preload"
		| "prerender"
		| "prev"
		| "privacy-policy"
		| "search"
		| "stylesheet"
		| "terms-of-service"
		// allows multiple
		| (string & {});
	sizes: string;
	type: string;
}>; // not strictly a void element since it can have children in XML

type MapAttributes = Attributes<{ name: string }>;

type MetaAttributes = Attributes<
	{
		charset: "utf-8";
		content: string;
		"http-equiv":
			| "content-security-policy"
			| "content-type"
			| "default-style"
			| "x-ua-compatible"
			| "refresh";
		media: string;
		name:
			| "application-name"
			| "author"
			| "description"
			| "generator"
			| "keywords"
			| "theme-color"
			| "viewport"
			// allow non-standard meta names
			| (string & {});
	},
	undefined
>;

type MeterAttributes = Attributes<{
	value: string | number;
	min: string | number;
	max: string | number;
	low: string | number;
	high: string | number;
	optimum: string | number;
	form: string;
}>;

type ObjectAttributes = Attributes<{
	data: string;
	form: string;
	height: string | number;
	name: string;
	type: string;
	width: string | number;
}>;

type OlAttributes = Attributes<{
	reversed: boolean;
	start: string | number;
	type: "a" | "A" | "i" | "I" | "1";
}>;

type OptgroupAttributes = Attributes<{ disabled: boolean; label: string }>;

type OptionAttributes = Attributes<{
	disabled: boolean;
	label: string;
	selected: boolean;
	value: string;
}>;

type OutputAttributes = Attributes<{ for: string; form: string; name: string }>;

type ProgressAttributes = Attributes<{
	max: string | number;
	value: string | number;
}>;

type QAttributes = Attributes<{ cite: string }>;

type ScriptAttributes = Attributes<{
	async: boolean;
	blocking: SharedAttributes["blocking"];
	crossorigin: SharedAttributes["crossorigin"];
	defer: boolean;
	fetchpriority: SharedAttributes["fetchpriority"];
	integrity: string;
	nomodule: boolean;
	referrerpolicy: SharedAttributes["referrerpolicy"];
	src: string;
	type: "module" | "importmap" | "speculationrules";
}>;

type SelectAttributes = Attributes<{
	autocomplete: SharedAttributes["autocomplete"];
	disabled: boolean;
	form: string;
	multiple: boolean;
	name: string;
	required: boolean;
	size: string | number;
}>;

type SlotAttributes = Attributes<{ name: string }>;

type SourceAttributes = Attributes<
	{
		height: string | number;
		media: string;
		sizes: string;
		src: string;
		srcset: string;
		type: string;
		width: string | number;
	},
	undefined
>;

type StyleAttributes = Attributes<{
	blocking: SharedAttributes["blocking"];
	media: string;
}>;

type TdAttributes = Attributes<{
	colspan: string | number;
	headers: string;
	rowspan: string | number;
}>;

type TemplateAttributes = Attributes<{
	shadowrootmode: "open" | "closed";
	shadowrootclonable: boolean;
	shadowrootdelegatesfocus: boolean;
	shadowrootserializable: boolean;
}>;

type TextareaAttributes = Attributes<{
	autocomplete: SharedAttributes["autocomplete"];
	cols: string | number;
	dirname: string;
	disabled: boolean;
	form: string;
	maxlength: string | number;
	minlength: string | number;
	name: string;
	placeholder: string;
	readonly: boolean;
	required: boolean;
	rows: string | number;
	wrap: "hard" | "soft" | "off";
}>;

type ThAttributes = Attributes<{
	abbr: string;
	colspan: string | number;
	headers: string;
	rowspan: string | number;
	scope: "row" | "col" | "rowgroup" | "colgroup" | (string & {});
}>;

type TimeAttributes = Attributes<{ datetime: string }>;

type TrackAttributes = Attributes<
	{
		default: boolean;
		kind: "subtitles" | "captions" | "chapters" | "metadata";
		label: string;
		src: string;
		srclang: string;
	},
	undefined
>;

type VideoAttributes = Attributes<{
	autoplay: boolean;
	controls: boolean;
	controlslist: SharedAttributes["controlslist"];
	crossorigin: SharedAttributes["crossorigin"];
	disablepictureinpicture: boolean;
	disableremoteplayback: boolean;
	height: string | number;
	loop: boolean;
	muted: boolean;
	playsinline: boolean;
	poster: string;
	preload: SharedAttributes["preload"];
	src: string;
	width: string | number;
}>;

// XML
type XMLAttributes<
	P extends JSX.Props = JSX.Props,
	Children = JSX.Element,
> = Partial<{ children: Children; xmlns: string }> & JSX.Props & Partial<P>;

type XMLDeclarationAttributes = {
	version?: "1.0" | (string & {});
	encoding?: "utf-8" | (string & {});
	standalone?: "yes" | "no";
};

type RSSAttributes = XMLAttributes<{
	version: "2.0" | (string & {});
	"xmlns:atom": string;
}>;

type AtomLinkAttributes = {
	href: string;
	rel?: "alternate" | "related" | "self" | "enclosure" | "via" | (string & {});
	type?:
		| "application/atom+xml"
		| "application/rss+xml"
		| "application/xml"
		| "text/xml"
		| "text/html"
		| (string & {});
	hreflang?: string;
	title?: string;
	length?: string | number;
};

// SVG
// SVG
type SvgAttributes<
	P extends JSX.Props = JSX.Props,
	Children = JSX.Element,
> = Partial<{
	children: Children;
	// Core attributes
	id: string;
	class: string;
	style: string;
	// Presentation attributes
	fill: string;
	"fill-opacity": string | number;
	"fill-rule": "nonzero" | "evenodd";
	stroke: string;
	"stroke-width": string | number;
	"stroke-opacity": string | number;
	"stroke-linecap": "butt" | "round" | "square";
	"stroke-linejoin": "miter" | "round" | "bevel";
	"stroke-dasharray": string;
	"stroke-dashoffset": string | number;
	opacity: string | number;
	transform: string;
	"transform-origin": string;
	// Clipping / masking
	"clip-path": string;
	"clip-rule": "nonzero" | "evenodd";
	mask: string;
}> &
	JSX.Props &
	Partial<P>;

type SvgRootAttributes = SvgAttributes<{
	xmlns: string;
	"xmlns:xlink": string;
	width: string | number;
	height: string | number;
	viewBox: string;
	preserveAspectRatio:
		| "none"
		| "xMinYMin"
		| "xMidYMin"
		| "xMaxYMin"
		| "xMinYMid"
		| "xMidYMid"
		| "xMaxYMid"
		| "xMinYMax"
		| "xMidYMax"
		| "xMaxYMax"
		| (string & {});
}>;

type SvgPathAttributes = SvgAttributes<{ d: string }>;

type SvgCircleAttributes = SvgAttributes<{
	cx: string | number;
	cy: string | number;
	r: string | number;
}>;

type SvgEllipseAttributes = SvgAttributes<{
	cx: string | number;
	cy: string | number;
	rx: string | number;
	ry: string | number;
}>;

type SvgRectAttributes = SvgAttributes<{
	x: string | number;
	y: string | number;
	width: string | number;
	height: string | number;
	rx: string | number;
	ry: string | number;
}>;

type SvgLineAttributes = SvgAttributes<{
	x1: string | number;
	y1: string | number;
	x2: string | number;
	y2: string | number;
}>;

type SvgPolylineAttributes = SvgAttributes<{ points: string }>;

type SvgPolygonAttributes = SvgAttributes<{ points: string }>;

type SvgTextAttributes = SvgAttributes<{
	x: string | number;
	y: string | number;
	dx: string | number;
	dy: string | number;
	"text-anchor": "start" | "middle" | "end";
	"dominant-baseline":
		| "auto"
		| "middle"
		| "hanging"
		| "mathematical"
		| "text-top"
		| "text-bottom"
		| (string & {});
	"font-family": string;
	"font-size": string | number;
	"font-weight": string | number;
	"letter-spacing": string | number;
}>;

type SvgTspanAttributes = SvgAttributes<{
	x: string | number;
	y: string | number;
	dx: string | number;
	dy: string | number;
}>;

type SvgUseAttributes = SvgAttributes<{
	href: string;
	"xlink:href": string;
	x: string | number;
	y: string | number;
	width: string | number;
	height: string | number;
}>;

type SvgSymbolAttributes = SvgAttributes<{
	viewBox: string;
	preserveAspectRatio: SvgRootAttributes["preserveAspectRatio"];
}>;

type SvgImageAttributes = SvgAttributes<{
	href: string;
	"xlink:href": string;
	x: string | number;
	y: string | number;
	width: string | number;
	height: string | number;
	preserveAspectRatio: SvgRootAttributes["preserveAspectRatio"];
}>;

type SvgLinearGradientAttributes = SvgAttributes<
	{
		x1: string | number;
		y1: string | number;
		x2: string | number;
		y2: string | number;
		gradientUnits: "userSpaceOnUse" | "objectBoundingBox";
		gradientTransform: string;
		spreadMethod: "pad" | "reflect" | "repeat";
	},
	undefined
>;

type SvgRadialGradientAttributes = SvgAttributes<
	{
		cx: string | number;
		cy: string | number;
		r: string | number;
		fx: string | number;
		fy: string | number;
		gradientUnits: "userSpaceOnUse" | "objectBoundingBox";
		gradientTransform: string;
		spreadMethod: "pad" | "reflect" | "repeat";
	},
	undefined
>;

type SvgStopAttributes = SvgAttributes<
	{
		offset: string | number;
		"stop-color": string;
		"stop-opacity": string | number;
	},
	undefined
>;

type SvgClipPathAttributes = SvgAttributes<{
	clipPathUnits: "userSpaceOnUse" | "objectBoundingBox";
}>;

type SvgMaskAttributes = SvgAttributes<{
	x: string | number;
	y: string | number;
	width: string | number;
	height: string | number;
	maskUnits: "userSpaceOnUse" | "objectBoundingBox";
	maskContentUnits: "userSpaceOnUse" | "objectBoundingBox";
}>;

type SvgForeignObjectAttributes = SvgAttributes<{
	x: string | number;
	y: string | number;
	width: string | number;
	height: string | number;
}>;

/** Standard HTML/XML elements */
export type IntrinsicElements =
	// allows custom elements
	Record<string, Attributes> & {
		a: AAttributes;
		abbr: Attributes;
		address: Attributes;
		area: AreaAttributes;
		article: Attributes;
		aside: Attributes;
		audio: AudioAttributes;
		base: BaseAttributes;
		bdi: Attributes;
		bdo: Attributes;
		blockquote: BlockquoteAttributes;
		body: BodyAttributes;
		br: Attributes<JSX.Props, undefined>;
		button: ButtonAttributes;
		canvas: CanvasAttributes;
		caption: Attributes;
		cite: Attributes;
		code: Attributes;
		col: ColAttributes;
		colgroup: ColgroupAttributes;
		data: DataAttributes;
		datalist: Attributes;
		dd: Attributes;
		del: DelAttributes;
		details: DetailsAttributes;
		dfn: Attributes;
		dialog: DialogAttributes;
		div: Attributes;
		dl: Attributes;
		dt: Attributes;
		em: Attributes;
		embed: EmbedAttributes;
		fieldset: FieldsetAttributes;
		figcaption: Attributes;
		figure: Attributes;
		footer: Attributes;
		form: FormAttributes;
		h1: Attributes;
		h2: Attributes;
		h3: Attributes;
		h4: Attributes;
		h5: Attributes;
		h6: Attributes;
		head: Attributes;
		header: Attributes;
		hgroup: Attributes;
		hr: Attributes<JSX.Props, undefined>;
		html: HtmlAttributes;
		iframe: IframeAttributes;
		i: Attributes;
		img: ImgAttributes;
		input: InputAttributes;
		ins: InsAttributes;
		kbd: Attributes;
		label: LabelAttributes;
		legend: Attributes;
		li: LiAttributes;
		link: LinkAttributes;
		main: Attributes;
		map: MapAttributes;
		mark: Attributes;
		menu: Attributes;
		meta: MetaAttributes;
		meter: MeterAttributes;
		nav: Attributes;
		noscript: Attributes;
		object: ObjectAttributes;
		ol: OlAttributes;
		optgroup: OptgroupAttributes;
		option: OptionAttributes;
		output: OutputAttributes;
		p: Attributes;
		picture: Attributes;
		pre: Attributes;
		progress: ProgressAttributes;
		q: QAttributes;
		rp: Attributes;
		rt: Attributes;
		ruby: Attributes;
		s: Attributes;
		samp: Attributes;
		script: ScriptAttributes;
		search: Attributes;
		section: Attributes;
		select: SelectAttributes;
		slot: SlotAttributes;
		small: Attributes;
		source: SourceAttributes;
		span: Attributes;
		strong: Attributes;
		style: StyleAttributes;
		sub: Attributes;
		summary: Attributes;
		sup: Attributes;
		table: Attributes;
		tbody: Attributes;
		td: TdAttributes;
		template: TemplateAttributes;
		textarea: TextareaAttributes;
		tfoot: Attributes;
		th: ThAttributes;
		thead: Attributes;
		time: TimeAttributes;
		title: Attributes;
		tr: Attributes;
		track: TrackAttributes;
		u: Attributes;
		ul: Attributes;
		var: Attributes;
		video: VideoAttributes;
		wbr: Attributes<JSX.Props, undefined>;

		// XML that have xmlns or more
		// custom are still allowed so they are covered
		xml: XMLDeclarationAttributes;
		rss: RSSAttributes;
		channel: XMLAttributes;
		item: XMLAttributes;
		urlset: XMLAttributes;
		"atom:link": AtomLinkAttributes;

		// SVG
		svg: SvgRootAttributes;
		g: SvgAttributes;
		defs: SvgAttributes;
		path: SvgPathAttributes;
		circle: SvgCircleAttributes;
		ellipse: SvgEllipseAttributes;
		rect: SvgRectAttributes;
		line: SvgLineAttributes;
		polyline: SvgPolylineAttributes;
		polygon: SvgPolygonAttributes;
		text: SvgTextAttributes;
		tspan: SvgTspanAttributes;
		use: SvgUseAttributes;
		symbol: SvgSymbolAttributes;
		image: SvgImageAttributes;
		linearGradient: SvgLinearGradientAttributes;
		radialGradient: SvgRadialGradientAttributes;
		stop: SvgStopAttributes;
		clipPath: SvgClipPathAttributes;
		mask: SvgMaskAttributes;
		foreignObject: SvgForeignObjectAttributes;
	};
