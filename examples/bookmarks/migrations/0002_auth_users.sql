-- Auth's tables are created before this; deleting an account removes its passkeys and sessions
ALTER TABLE auth_credentials ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
ALTER TABLE auth_sessions ADD FOREIGN KEY ("user") REFERENCES users ON DELETE CASCADE;
