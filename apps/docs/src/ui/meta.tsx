export const Meta = (props: { title: string; description: string }) => {
	return (
		<>
			<title>
				{props.title === "ovr"
					? props.title + " | " + props.description
					: `${props.title} | ovr`}
			</title>
			<meta name="description" content={props.description} />
		</>
	);
};
