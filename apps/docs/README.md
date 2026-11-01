# Docs

Run `npm run dev` from the repository root, or `npm run dev --workspace docs` to start only the docs server.

## Auth demo

The demo at `/demo/auth` and its navigation link are available only in Vite development mode when `AUTH_SECRET` is set. Production builds exclude the SQLite demo backend and its routes. The public authentication guide is at `/08-auth`.

Set these server-side values in `apps/docs/.env`:

```dotenv
AUTH_SECRET=your-random-secret
AUTH_ORIGIN=https://localhost:5173
```

Generate a secret containing at least 32 random bytes, for example:

```bash
node -e 'console.log(crypto.getRandomValues(new Uint8Array(32)).toHex())'
```

Place a browser-trusted localhost certificate in `apps/docs/.auth-cert.pem` and its private key in `apps/docs/.auth-key.pem`. Vite uses HTTPS when these files are present and keeps port 5173 fixed to match the origin. Restart the dev server after changing environment variables, then open `https://localhost:5173/demo/auth`.

The demo uses Node's built-in SQLite driver and a fixed loopback client identity. Its database defaults to `apps/docs/.auth.sqlite`; `AUTH_DATABASE` can select another local path. Accounts and passkeys persist across restarts. The default database, SQLite journal files, environment files, and TLS keys are ignored by Git. Keep a custom database path out of version control too.

This is a local test application, not a production storage adapter. It caps outstanding challenges at 1,000 overall and 10 per browser, and rate-limit records at 10,000. Expired records are pruned on startup and during writes. Refusing new records when full denies admission; it does not replace aggregate or edge abuse protection. Production applications need shared storage and their server's real trusted client identity.
