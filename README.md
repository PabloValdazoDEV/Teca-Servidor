# Teca API

## Security configuration

Copy `.env.example` to `.env` and provide real secrets. Production startup is
intentionally rejected when `JWT_SECRET` is shorter than 32 bytes.

- `CORS_ALLOWED_ORIGINS` is a comma-separated allowlist of exact frontend
  origins. Never use `*` with credentialed requests.
- Authentication is stored in an `HttpOnly`, `Secure` (production),
  `SameSite=Strict` cookie and expires after `JWT_TTL_SECONDS` (15 minutes by
  default).
- The production frontend and API should remain on the same site (for example
  `teca.pablovaldazo.es` and `api.teca.pablovaldazo.es`) so strict cookies work.
- HTTPS is required in production. Terminate TLS at the reverse proxy and
  forward the original protocol correctly.
- Do not create `VITE_` variables containing secrets: Vite embeds them in the
  public browser bundle.

After changing authentication secrets, all existing sessions are invalidated.

The `seed_user` script has no default credentials. Set
`BOOTSTRAP_ADMIN_EMAIL` and a strong `BOOTSTRAP_ADMIN_PASSWORD` only while
bootstrapping the initial `SUPERADMIN`, then remove both values from the
environment.

## Account recovery and remembered sessions

- Set `FRONTEND_URL` to the exact public frontend origin. It must also appear
  in `CORS_ALLOWED_ORIGINS`.
- `USER_GMAIL` and `PASSWORD_APP` are required to deliver password recovery
  emails.
- Recovery links contain a single-use random token in the URL fragment, expire
  after 30 minutes, and only a SHA-256 hash is stored in the database.
- “Remember me” stores a rotating opaque token in an `HttpOnly` cookie for a
  fixed maximum of 30 days. Up to five remembered sessions are retained per
  user.
- Password resets revoke every remembered session belonging to the user.

Before deploying this version to an existing database, apply the additive SQL
files once, after taking a database backup:

```sh
prisma db execute --file prisma/security_schema_update.sql --schema prisma/schema.prisma
prisma db execute --file prisma/clinic_documents_update.sql --schema prisma/schema.prisma
```

Clinical documents are stored outside PostgreSQL. Configure
`DOCUMENT_STORAGE_PATH`, keep it outside the public web root and back it up at
the same time as the database.

## Historical import

`npm run import:plan` reads the historical `PACIENTES.xlsm` and attachment
folders, normalizes names and writes a report without modifying the database.
Only unique name/prefix matches are automatic; ambiguous or unmatched folders
remain in the report for manual mapping. After reviewing the report, run
`npm run import:apply` to copy (never move) supported files into versioned
storage and create patients idempotently by their source row.
