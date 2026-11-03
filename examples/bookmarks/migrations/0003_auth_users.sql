-- Auth.sql[1] is applied as 0002_auth in migrate.ts; deleting an account removes its passkeys and sessions
ALTER TABLE auth_credentials ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
ALTER TABLE auth_sessions ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
