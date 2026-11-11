export const bytes = 123734;
export const kb = 123.73;

export const App = { bytes: 53123, kb: 53.12 } as const;

export const Auth = { bytes: 86686, kb: 86.69 } as const;

export const Database = { bytes: 23929, kb: 23.93 } as const;

export const Field = { bytes: 21723, kb: 21.72 } as const;

export const Limiter = { bytes: 16706, kb: 16.71 } as const;

export const Markdown = { bytes: 17855, kb: 17.86 } as const;

export const Markup = { bytes: 5872, kb: 5.87 } as const;

export const Mcp = { bytes: 40679, kb: 40.68 } as const;

export const Multipart = { bytes: 7922, kb: 7.92 } as const;

export const Route = { bytes: 26858, kb: 26.86 } as const;

export const Schema = { bytes: 10895, kb: 10.9 } as const;

export const Table = { bytes: 13001, kb: 13 } as const;

export const sizes = {
	App,
	Auth,
	Database,
	Field,
	Limiter,
	Markdown,
	Markup,
	Mcp,
	Multipart,
	Route,
	Schema,
	Table,
} as const;
