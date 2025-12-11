import "@docsearch/css";
import docsearch from "@docsearch/js";

export class DocSearch extends HTMLElement {
	#closeOtherPopovers() {
		const popovers = document.querySelectorAll<HTMLElement>("[popover]");

		for (const popover of popovers) {
			popover.hidePopover();
		}
	}

	connectedCallback() {
		this.addEventListener("click", this.#closeOtherPopovers);

		docsearch({
			container: this,
			theme: window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light",
			appId: "IRCH4YFJ8Q",
			indices: ["ovr-docs"],
			keyboardShortcuts: { "Ctrl/Cmd+K": true, "/": true },
			apiKey: "5f6aee0367c58fab80033f9563cc07fb",
		});
	}
}
