-- and its sign-in links
ALTER TABLE auth_links ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
