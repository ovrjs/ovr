import type { Route } from "../route/index.js";

class ParamNode {
	/** Name of the parameter (without the colon ":") */
	readonly name: string;

	/** Matched route */
	route?: Route;

	/** Static child node */
	child?: Trie;

	/**
	 * Create a new parameter node.
	 *
	 * @param name Name of the parameter.
	 */
	constructor(name: string) {
		this.name = name;
	}
}

export namespace Trie {
	/** Params created from the route match */
	export type Params = Record<string, string>;
}

export class Trie {
	/** Unique segment of the pattern trie */
	readonly seg: string;

	/** Static child node map, key is the first character in the segment */
	map?: Map<number, Trie>;

	/** Parametric child node */
	param?: ParamNode;

	/** Matched route */
	route?: Route;

	/** Matched wildcard route */
	wild?: Route;

	static readonly #paramMatch = /:.+?(?=\/|$)/g;
	static readonly #paramSplit = /:.+?(?=\/|$)/;

	/**
	 * Create a new trie.
	 *
	 * @param segment pattern segment
	 * @param children static children nodes to add to staticMap
	 */
	constructor(segment = "/", children?: Trie[]) {
		this.seg = segment;

		if (children?.length) {
			this.map ??= new Map();

			for (const child of children) {
				this.map.set(child.seg.charCodeAt(0), child);
			}
		}
	}

	/**
	 * @param segment new segment
	 * @returns a clone of the Node with a new segment
	 */
	clone(segment: string) {
		const clone = new Trie(segment);

		clone.map = this.map;
		clone.param = this.param;
		clone.route = this.route;
		clone.wild = this.wild;

		return clone;
	}

	/**
	 * If the current segment is "api/posts/"
	 * and "api/movies/" is added,
	 * the node will need to be reassigned to "api/" and create two static children.
	 *
	 * @param charIndex	where to split the node
	 * @param segment new segment to use
	 * @returns the new child produced from the new segment
	 */
	fork(charIndex: number, segment: string) {
		const newChild = new Trie(segment.slice(charIndex)); // "movies/"

		Object.assign(
			this,
			// "api/" with the above as children
			new Trie(this.seg.slice(0, charIndex), [
				this.clone(this.seg.slice(charIndex)), // "posts/"
				newChild,
			]),
		);

		return newChild;
	}

	/**
	 * node.segment = "static/static",
	 * staticSegment = "static/",
	 * then the node needs to be split to accommodate the shorter segment
	 *
	 * @param segment
	 */
	split(segment: string) {
		Object.assign(
			this,
			new Trie(segment, [this.clone(this.seg.slice(segment.length))]),
		);
	}

	/**
	 * @param name name of the param
	 * @returns the existing child with the same name, or creates a new
	 */
	set(name: string) {
		return (this.param ??= new ParamNode(name));
	}

	/**
	 * @param route route return when pattern is matched
	 * @returns this - the Node
	 */
	add(route: Route) {
		let current: Trie = this;
		let pattern = route.method + route.pattern; // created to not modify the original

		const endsWithWildcard = pattern.endsWith("*");
		if (endsWithWildcard) pattern = pattern.slice(0, -1);

		const paramSegments = pattern.match(Trie.#paramMatch) ?? [];
		const staticSegments = pattern.split(Trie.#paramSplit);

		// if the last segment is a param without a trailing slash
		// then there will be an empty string, remove
		if (staticSegments.at(-1) === "") staticSegments.pop();

		let paramIndex = 0;
		// for each static segment, if there are no static segments, this is skipped
		for (
			let staticIndex = 0;
			staticIndex < staticSegments.length;
			staticIndex++
		) {
			let staticSegment = staticSegments[staticIndex]!;

			if (staticIndex > 0) {
				// there is only a second static segment (could just be "/")
				// if there is a param to split them, so there must be a param here

				const paramChild = current.set(
					// param without the ":" (only increment when this is reached)
					paramSegments[paramIndex++]!.slice(1),
				);

				if (!paramChild.child) {
					// new - create node with the next static segment
					current = paramChild.child = new Trie(staticSegment);
					continue; // next segment - no need to check since it's new
				}

				// there's already a static child - need to check if it's a match
				current = paramChild.child;
			}

			// check if the staticSegment matches the current node
			for (let charIndex = 0; ; ) {
				if (charIndex === staticSegment.length) {
					// finished iterating through the staticSegment
					if (charIndex < current.seg.length) {
						// too short
						current.split(staticSegment);
					}

					break; // next segment
				}

				if (charIndex === current.seg.length) {
					// passed the end of the current node
					if (!current.map) {
						// new pattern, create new leaf
						current.map = new Map();
					} else {
						// there's already static children,
						// check to see if there's a leaf that starts with the char
						const staticChild = current.map.get(
							staticSegment.charCodeAt(charIndex),
						);

						if (staticChild) {
							// re-run loop with existing staticChild
							current = staticChild;
							staticSegment = staticSegment.slice(charIndex);
							charIndex = 0;
							continue;
						}
					}

					// otherwise, add new staticChild
					const staticChild = new Trie(staticSegment.slice(charIndex));
					current.map.set(staticSegment.charCodeAt(charIndex), staticChild);
					current = staticChild;

					break; // next segment
				}

				if (staticSegment[charIndex] !== current.seg[charIndex]) {
					// different than the node - fork
					current = current.fork(charIndex, staticSegment);

					break; // next segment
				}

				// character is the same - rerun to check next char
				charIndex++;
			}
		}

		if (paramIndex < paramSegments.length) {
			// final segment is a param
			current.set(paramSegments[paramIndex]!.slice(1)).route = route;
		} else if (endsWithWildcard) {
			// final segment is a wildcard
			current.wild = route;
		} else {
			// final segment is static
			current.route = route;
		}

		return this;
	}

	/**
	 * @param pathname Path to find
	 * @returns `Route` and the matched `params` if found, otherwise `null`
	 */
	find(pathname: string): { route: Route; params: Trie.Params } | null {
		const segmentLength = this.seg.length;

		if (
			// too short
			pathname.length < segmentLength ||
			// segment does not match current node segment
			!pathname.startsWith(this.seg)
		) {
			return null;
		}

		if (pathname === this.seg) {
			// reached the end of the path
			if (this.route) return { route: this.route, params: {} };

			if (this.wild) return { route: this.wild, params: { "*": "" } };

			return null;
		}

		if (this.map) {
			// check for a static leaf that starts with the first character
			const staticChild = this.map.get(pathname.charCodeAt(segmentLength));

			if (staticChild) {
				const result = staticChild.find(pathname.slice(segmentLength));
				if (result) return result;
			}
		}

		// check for param leaf
		if (this.param) {
			const slashIndex = pathname.indexOf("/", segmentLength);

			// if there is not a slash immediately following this.segment
			if (slashIndex !== segmentLength) {
				// there is a valid parameter
				if (
					// param is the end of the pathname
					slashIndex === -1 &&
					this.param.route
				) {
					return {
						route: this.param.route,
						params: { [this.param.name]: pathname.slice(segmentLength) },
					};
				} else if (this.param.child) {
					// there's a static node after the param
					// this is how there can be multiple params, "/" in between
					const result = this.param.child.find(pathname.slice(slashIndex));

					if (result) {
						// add original params to the result
						result.params[this.param.name] = pathname.slice(
							segmentLength,
							slashIndex,
						);

						return result;
					}
				}
			}
		}

		// check for wildcard leaf
		if (this.wild) {
			return {
				route: this.wild,
				params: { "*": pathname.slice(segmentLength) },
			};
		}

		return null;
	}
}
