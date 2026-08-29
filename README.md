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

## Appointment communications

Automatic appointment notifications are controlled from the server `.env`:

```env
APPOINTMENT_COMMUNICATIONS_ENABLED=false
PREFERRED_COMMUNICATION_CHANNELS=PHONE,EMAIL
TWILIO_ENABLED=false
```

- `APPOINTMENT_COMMUNICATIONS_ENABLED=true` enables notifications according to
  each patient's preferred communication channel.
- `PREFERRED_COMMUNICATION_CHANNELS` controls which options are available in
  patient forms. Valid values are `PHONE`, `EMAIL`, `WHATSAPP` and `SMS`.
- `TWILIO_ENABLED=true` enables the Twilio provider. Both variables must be
  `true` for appointment SMS delivery.
- With appointment communications disabled, appointments are still created and
  updated normally, but no automatic email or SMS is sent.

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
prisma db execute --file prisma/clinic_pricing_backup_update.sql --schema prisma/schema.prisma
prisma db execute --file prisma/preferred_communication_default_update.sql --schema prisma/schema.prisma
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

By default, every legacy source is resolved inside the backend directory using
this exact, case-sensitive structure:

```text
Teca-Servidor/
  Ejemplos clientes/
    Pacientes/PACIENTES.xlsm
    Datos adjuntos/
    Fichas Paciente/
      FICHA.XLS
      VISCERAL Y CRANEAL.doc
      HISTORIAL CLINICO.docx
```

Keep this directory private and outside the frontend/public web root. It is
ignored by Git because it can contain clinical and identifying data, so it must
be copied securely into `Teca-Servidor` during production deployment. The
importer copies attachments into versioned storage and never modifies these
source files.

You can point the same command at the complete real folders without editing
`.env`:

```sh
npm run import:plan -- --patients-file="/ruta/PACIENTES.xlsm" --attachments="/ruta/Datos adjuntos"
npm run import:apply -- --patients-file="/ruta/PACIENTES.xlsm" --attachments="/ruta/Datos adjuntos"
```

If a deployment needs a different private location, set
`LEGACY_EXAMPLES_PATH`; `LEGACY_PATIENTS_FILE`, `LEGACY_ATTACHMENTS_PATH` and
`PATIENT_TEMPLATE_PATH` remain available as more specific overrides.

Apply mode prints progress every 100 patients. Its JSON report records the
TECA `customerId`, visible `customerNumber`, source row and matched folder for
every imported patient. Re-running it does not duplicate patients or files.

The visible TECA patient ID is imported from column J (`ID`) of the historical
workbook. The internal UUID remains unchanged and is only used for secure
database relations. Imported patients use phone calls as their initial
preferred communication channel. Before replacing a previous import, inspect the deletion
plan and take a backup:

```sh
npm run customers:delete-all
npm run customers:delete-all -- --apply --confirm=BORRAR-TODOS-LOS-CLIENTES
npm run import:apply
```

The delete command removes every patient and, through database cascades, their
appointments, phones, documents and clinical records. It does not delete user,
clinic or practitioner accounts. The command is a dry run unless both
`--apply` and the exact confirmation phrase are supplied.
