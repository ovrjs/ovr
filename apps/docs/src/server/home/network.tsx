import * as network from "@/lib/network";

const ticks = [0, 250, 500, 750, 1000];

/**
 * A browser's network panel loading a page, streamed or buffered, replayed in
 * the browser and drawn finished without JavaScript.
 */
export const Network = () => {
	const mode: network.Mode = "streamed";
	const timing = network.timings[mode];
	const frame = network.frame(mode, network.duration);

	return (
		<network-demo class="block" data-mode={mode}>
			<figure class="my-0">
				<div class="border-secondary bg-background [scrollbar-gutter:auto] overflow-hidden rounded-md border font-mono text-xs shadow-sm [--name:6.5rem] sm:[--name:9rem]">
					<div class="bg-muted border-secondary text-muted-foreground flex [scrollbar-gutter:auto] gap-4 overflow-hidden border-b px-3 whitespace-nowrap">
						{["Elements", "Console", "Sources", "Network", "Performance"].map(
							(tab) => (
								<span
									class={
										tab === "Network"
											? "text-foreground border-foreground -mb-px border-b py-2"
											: "py-2"
									}
								>
									{tab}
								</span>
							),
						)}
					</div>

					<div class="grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
						<div class="relative">
							<div class="border-secondary text-muted-foreground grid h-7 grid-cols-[var(--name)_1fr] items-center border-b">
								<span class="px-3">Name</span>
								<span class="relative mx-3 h-full">
									{ticks.map((ms, i) => (
										<span
											class={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap ${i === ticks.length - 1 ? "-translate-x-full" : i ? "-translate-x-1/2" : ""} ${i % 2 ? "max-sm:hidden" : ""}`}
											style={`left:${(ms / network.duration) * 100}%`}
										>
											{ms ? `${ms} ms` : "0"}
										</span>
									))}
								</span>
							</div>

							{network.requests.map((request, i) => (
								<div
									data-request={i}
									class="border-secondary grid h-8 grid-cols-[var(--name)_1fr] items-center border-b"
								>
									<span class="truncate px-3">{request}</span>
									<span class="relative mx-3 h-full">
										<span
											data-wait
											class="bg-base-300 dark:bg-base-700 absolute top-1/2 h-2 -translate-y-1/2"
											style={frame.requests[i]!.wait}
										/>
										<span
											data-load
											class={`absolute top-1/2 h-2 -translate-y-1/2 ${i ? "bg-base-500" : "bg-foreground"}`}
											style={frame.requests[i]!.load}
										/>
										{i === 0 &&
											frame.chunks.map((chunk) => (
												<span
													data-chunk
													data-arrived={chunk.arrived ? "" : undefined}
													class="bg-foreground absolute top-1/2 h-4 w-px -translate-y-1/2"
													style={chunk.left}
												/>
											))}
									</span>
								</div>
							))}

							{/* room under the requests for the paint label */}
							<div class="h-6" />

							{/* lines down the waterfall, under its header */}
							<div
								aria-hidden="true"
								class="pointer-events-none absolute inset-y-0 right-0 left-(--name) mx-3"
							>
								<span
									data-paint
									data-shown={frame.paint.shown ? "" : undefined}
									class="border-base-400 absolute top-7 bottom-0 border-l border-dashed"
									style={frame.paint.left}
								>
									<span class="text-muted-foreground bg-background absolute bottom-0 left-1 px-0.5 leading-4">
										paint
									</span>
								</span>
								<span
									data-playhead
									class="bg-silver absolute inset-y-0 w-px opacity-0"
									style={frame.playhead}
								/>
							</div>
						</div>

						<div class="border-secondary border-t lg:border-t-0 lg:border-l">
							<div class="border-secondary text-muted-foreground flex h-7 items-center gap-3 border-b px-3">
								<span>Headers</span>
								<span class="text-foreground border-foreground -mb-px flex h-full items-center border-b">
									Response
								</span>
								<span>Timing</span>
							</div>
							<pre class="text-foreground my-0 [scrollbar-gutter:auto] rounded-none bg-transparent px-3 py-2 text-xs leading-4 [tab-size:2]">
								<code>
									{network.chunks.map((chunk, i) => (
										<span
											data-response={i}
											data-arrived={frame.chunks[i]!.arrived ? "" : undefined}
										>
											{chunk}
										</span>
									))}
								</code>
							</pre>
						</div>
					</div>

					<div class="bg-muted border-secondary text-muted-foreground flex flex-wrap gap-x-3 border-t px-3 py-1.5">
						<span>{network.requests.length} requests</span>
						<span>
							First paint: <span data-paint-time>{timing.paint} ms</span>
						</span>
						<span>
							Finish: <span data-finish-time>{timing.finish} ms</span>
						</span>
					</div>
				</div>

				<figcaption class="mt-3 flex flex-wrap items-center justify-between gap-3">
					<span
						data-modes
						hidden
						role="group"
						aria-label="How the page is sent"
						class="flex gap-1"
					>
						{(["streamed", "buffered"] as const).map((m) => (
							<button
								type="button"
								data-mode-button={m}
								aria-pressed={m === mode ? "true" : "false"}
								class="button ghost aria-pressed:bg-secondary h-8 px-3 text-sm capitalize"
							>
								{m}
							</button>
						))}
					</span>
					<span class="caption">
						illustrative timings, slowed {network.slowdown}×
					</span>
				</figcaption>
			</figure>
		</network-demo>
	);
};
