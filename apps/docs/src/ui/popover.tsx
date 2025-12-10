import clsx from "clsx";
import type * as ovr from "ovr";

type TriggerProps = ovr.JSX.IntrinsicElements["button"];
type PopoverProps = ovr.JSX.IntrinsicElements["div"] & {
	trigger: TriggerProps;
	titleHref?: string;
	titleContent?: ovr.JSX.Element;
};

export const Popover = (props: PopoverProps) => {
	const {
		title,
		children,
		trigger,
		titleHref,
		titleContent = title,
		...rest
	} = props;
	const { children: triggerChildren, ...triggerRest } = trigger;

	const id = rest.id ?? `popover-${Math.random().toString(36).substring(2, 6)}`;

	return (
		<>
			<Trigger id={id} aria-label={title} {...triggerRest}>
				{triggerChildren}
			</Trigger>

			<div
				id={id}
				{...rest}
				popover
				class="bg-background border-secondary backdrop:bg-muted/60 mx-auto my-auto max-h-[90dvh] min-w-xs overflow-y-auto rounded-md border p-7 opacity-0 shadow-2xl transition-[display,opacity] transition-discrete backdrop:opacity-0 backdrop:backdrop-blur-lg backdrop:transition-[display,opacity] backdrop:transition-discrete open:opacity-100 open:backdrop:opacity-100 motion-reduce:duration-0 sm:mx-auto sm:max-w-[60ch] starting:open:opacity-0 starting:open:backdrop:opacity-0"
			>
				<div class="flex items-center justify-between">
					{titleHref ? (
						<a href={titleHref} class="text-xl font-semibold no-underline">
							{titleContent}
						</a>
					) : (
						<div class="cursor-default text-xl font-semibold">
							{titleContent}
						</div>
					)}

					<Trigger id={id}>
						<span class="icon-[lucide--x]" />
					</Trigger>
				</div>

				<div class="pt-6">{children}</div>
			</div>
		</>
	);
};

const Trigger = (props: TriggerProps) => {
	const { id, class: className, children, ...rest } = props;

	return (
		<button
			popovertarget={id}
			type="button"
			class={clsx(!className && "icon ghost", className)}
			{...rest}
		>
			{children}
		</button>
	);
};
