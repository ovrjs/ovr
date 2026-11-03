-- Auth.sql[2] is applied as 0004_auth_agents in migrate.ts; deleting an account disconnects its agents
ALTER TABLE auth_tokens ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
