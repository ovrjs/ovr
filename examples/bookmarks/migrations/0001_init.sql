-- text, like Auth's user IDs, so Auth's tables can reference it
CREATE TABLE users (
	id text PRIMARY KEY,
	email text NOT NULL UNIQUE
);

CREATE TABLE bookmarks (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	owner text NOT NULL REFERENCES users ON DELETE CASCADE,
	title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
	url text NOT NULL CHECK (char_length(url) <= 300),
	created timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT bookmarks_owner_url UNIQUE (owner, url)
);
CREATE INDEX bookmarks_owner_created ON bookmarks (owner, created DESC, id DESC);
