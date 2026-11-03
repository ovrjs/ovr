-- deleting an account disconnects its agents
ALTER TABLE auth_tokens ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
