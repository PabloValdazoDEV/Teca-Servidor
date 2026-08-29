# Despliegue de TECA en Ubuntu con Plesk

Esta guía publica el frontend, el runtime de LibreOffice WebAssembly y la API bajo el mismo origen HTTPS. El esquema recomendado es:

- `https://teca.example.com/`: frontend estático.
- `https://teca.example.com/office/runtime/`: LibreOffice WebAssembly, sin CDN.
- `https://teca.example.com/api/`: proxy interno a Express en `127.0.0.1:3000`.
- PostgreSQL y los documentos clínicos no son públicos.

Sustituye `teca.example.com` y las rutas de ejemplo por los valores del servidor. No copies secretos en el repositorio.

## 1. Requisitos y directorios

Instala una versión LTS de Node compatible con las dependencias, PostgreSQL y las extensiones Node.js y SSL de Plesk. Reserva estos directorios fuera de `httpdocs`:

```text
/var/www/vhosts/teca.example.com/app/server
/var/lib/teca/documents
/var/lib/teca/templates
/var/backups/teca
```

El usuario que ejecuta Express debe tener lectura y escritura en `documents`, y solo lectura en `templates`. Los archivos deben mantenerse privados; no crees alias web hacia esos directorios.

El runtime WebAssembly ocupa aproximadamente 250 MB en disco, pero se ejecuta en el navegador. En un servidor de 4 GB no hay que instalar ni ejecutar LibreOffice nativo.

## 2. Copia de seguridad antes de actualizar

Antes de cualquier cambio de esquema, detén temporalmente las escrituras o activa mantenimiento y crea una copia coordinada de PostgreSQL y de los documentos:

```sh
pg_dump "$DATABASE_URL" --format=custom --file=/var/backups/teca/db_teca-AAAA-MM-DD.dump
tar -C /var/lib/teca -czf /var/backups/teca/documents-AAAA-MM-DD.tar.gz documents
pg_restore --list /var/backups/teca/db_teca-AAAA-MM-DD.dump >/dev/null
tar -tzf /var/backups/teca/documents-AAAA-MM-DD.tar.gz >/dev/null
```

Protege `/var/backups/teca`, cifra la copia externa y prueba periódicamente una restauración en otro entorno. Configura Plesk o el sistema de copias para incluir `/var/lib/teca/documents`; las copias normales de `httpdocs` no lo incluyen.

## 3. API y base de datos

En el directorio del servidor:

```sh
npm ci
npx prisma validate
npx prisma generate
npm test
```

Configura el entorno de producción desde Plesk o en un archivo con permisos `0600` que no esté bajo la raíz pública:

```dotenv
NODE_ENV=production
PORT=3000
BIND_HOST=127.0.0.1
DATABASE_URL=postgresql://USUARIO:CONTRASENA@127.0.0.1:5432/BASE_DE_DATOS?schema=public
JWT_SECRET=VALOR_ALEATORIO_DE_AL_MENOS_32_BYTES
JWT_TTL_SECONDS=900
JWT_ISSUER=teca-api
JWT_AUDIENCE=teca-web
CORS_ALLOWED_ORIGINS=https://teca.example.com
FRONTEND_URL=https://teca.example.com
DOCUMENT_STORAGE_PATH=/var/lib/teca/documents
USER_GMAIL=
PASSWORD_APP=
```

Genera `JWT_SECRET` con `openssl rand -hex 32`. Configura también Twilio si se van a enviar SMS. Elimina las variables `BOOTSTRAP_ADMIN_*` después de crear el primer administrador.

Copia de forma privada la carpeta completa `Ejemplos clientes` dentro de la raíz de `Teca-Servidor`, conservando exactamente este nombre y estructura:

```text
Teca-Servidor/Ejemplos clientes/
  Pacientes/PACIENTES.xlsm
  Datos adjuntos/
  Fichas Paciente/FICHA.XLS
  Fichas Paciente/VISCERAL Y CRANEAL.doc
  Fichas Paciente/HISTORIAL CLINICO.docx
```

No la coloques dentro de la raíz pública del frontend ni la subas a Git: puede contener datos clínicos. El backend usa esa ubicación automáticamente. Solo si el proveedor obliga a almacenarla en otro sitio privado, configura `LEGACY_EXAMPLES_PATH` con la ruta absoluta; las variables específicas `LEGACY_PATIENTS_FILE`, `LEGACY_ATTACHMENTS_PATH` y `PATIENT_TEMPLATE_PATH` siguen disponibles para casos excepcionales.

### Actualización del esquema existente

No uses `prisma db push` en producción. Después de validar la copia y confirmar que `DATABASE_URL` apunta a la base correcta, aplica cada actualización SQL una sola vez y registra la fecha:

```sh
npx prisma db execute --file prisma/security_schema_update.sql --schema prisma/schema.prisma
npx prisma db execute --file prisma/clinic_documents_update.sql --schema prisma/schema.prisma
npx prisma db execute --file prisma/clinic_pricing_backup_update.sql --schema prisma/schema.prisma
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

No vuelvas a ejecutar `security_schema_update.sql` sobre una base ya actualizada. Si el último comando muestra diferencias, detén el despliegue y revísalas antes de arrancar la aplicación.

Ejecuta `app.js` con la extensión Node.js de Plesk o con un servicio que reinicie el proceso si falla. Debe escuchar únicamente en `127.0.0.1:3000`; no abras ese puerto en el cortafuegos. Tras cada despliegue reinicia el proceso desde Plesk.

## 4. Frontend y LibreOffice en el navegador

En el equipo de compilación o en el servidor:

```sh
npm ci
npm run office:runtime
VITE_API_URL=https://teca.example.com/api npm run build
```

No definas `VITE_ZETA_OFFICE_RUNTIME_URL` en producción. Publica todo `dist/` en `httpdocs`, incluido `dist/office/runtime/`. No subas el runtime a un CDN ni a un servicio externo.

El proxy conserva `/api` en el navegador y lo elimina antes de llegar a Express. En “Apache & nginx Settings” del dominio, establece `client_max_body_size 30m` y añade el equivalente de estas directivas nginx, adaptándolo si Plesk ya gestiona algún bloque `location`:

```nginx
client_max_body_size 30m;

add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

location = /api {
    return 308 /api/;
}

location ^~ /api/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
}

location ^~ /office/runtime/ {
    types {
        application/javascript js;
        application/wasm wasm;
        application/octet-stream data metadata;
    }
    try_files $uri =404;
    expires 30d;
}
```

Para el enrutamiento SPA, configura una reescritura hacia `/index.html` solo cuando el archivo o directorio solicitado no exista. Con Apache detrás de Plesk, coloca esto en `httpdocs/.htaccess`:

```apache
Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_URI} !^/api/
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
AddType application/wasm .wasm
```

No añadas un segundo `location /` si la plantilla nginx de Plesk ya lo define. Valida siempre la configuración antes de aplicarla y conserva el proxy HTTPS de Plesk.

## 5. Verificación posterior

Comprueba desde una sesión privada del navegador:

```sh
curl -I https://teca.example.com/
curl -I https://teca.example.com/office/runtime/soffice.wasm
curl -I https://teca.example.com/api/system-status
```

El archivo `soffice.wasm` debe responder `200`, con `Content-Type: application/wasm`, `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp`. `/api/system-status` debe responder `401` sin sesión; tras iniciar sesión como administrador, la pantalla de estado debe confirmar base de datos, almacenamiento y correo.

Finalmente verifica:

1. Inicio y cierre de sesión, incluida la opción de 30 días.
2. Creación y edición de una cita.
3. Creación de las tres plantillas sin duplicados.
4. Apertura real de un Word y un Excel en el editor del navegador.
5. Guardado de ambos y aparición de una nueva versión descargable.
6. Exportación ZIP y presencia de `Pacientes/PACIENTES.xlsx`, adjuntos y `manifest.json`.

Los `.xlsm` se conservan como originales/versiones; no habilites ni ejecutes sus macros. Supervisa espacio libre, PostgreSQL, el proceso Node y el tamaño de `/var/lib/teca/documents`. Rota logs y conserva al menos una copia externa cifrada.
