const isProduction = process.env.NODE_ENV === "production";

const DEFAULT_PRODUCTION_ORIGINS = ["https://teca.pablovaldazo.es"];
const DEFAULT_DEVELOPMENT_ORIGINS = [
  ...DEFAULT_PRODUCTION_ORIGINS,
  "http://localhost:5173",
];

function normalizeOrigin(value) {
  const parsed = new URL(value);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported CORS origin protocol: ${parsed.protocol}`);
  }

  return parsed.origin;
}

function getAllowedOrigins() {
  const configuredOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origins = configuredOrigins?.length
    ? configuredOrigins
    : isProduction
      ? DEFAULT_PRODUCTION_ORIGINS
      : DEFAULT_DEVELOPMENT_ORIGINS;

  return new Set(origins.map(normalizeOrigin));
}

const allowedOrigins = getAllowedOrigins();
const frontendUrl = normalizeOrigin(
  process.env.FRONTEND_URL ||
    (isProduction ? "https://teca.pablovaldazo.es" : "http://localhost:5173")
);

if (!allowedOrigins.has(frontendUrl)) {
  throw new Error("FRONTEND_URL must also be present in CORS_ALLOWED_ORIGINS");
}

if (isProduction && !frontendUrl.startsWith("https://")) {
  throw new Error("FRONTEND_URL must use HTTPS in production");
}

const rawJwtTtlSeconds = process.env.JWT_TTL_SECONDS || "900";
const jwtTtlSeconds = /^\d+$/.test(rawJwtTtlSeconds)
  ? Number(rawJwtTtlSeconds)
  : Number.NaN;

if (!Number.isInteger(jwtTtlSeconds) || jwtTtlSeconds < 300 || jwtTtlSeconds > 3600) {
  throw new Error("JWT_TTL_SECONDS must be an integer between 300 and 3600");
}

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error("JWT_SECRET is required");
}

const insecureJwtSecret =
  jwtSecret === "replace-with-a-cryptographically-random-secret" ||
  /^(change-?me|secret|password|development)$/i.test(jwtSecret);

if (Buffer.byteLength(jwtSecret, "utf8") < 32 || insecureJwtSecret) {
  const message = "JWT_SECRET must contain at least 32 bytes of entropy";

  if (isProduction) {
    throw new Error(message);
  }

  if (process.env.NODE_ENV !== "test") {
    console.warn(`[security] ${message}; rotate it before deploying`);
  }
}

const sessionCookieName = isProduction
  ? "__Host-teca_session"
  : "teca_session";
const refreshCookieName = isProduction
  ? "__Host-teca_remember"
  : "teca_remember";
const rememberTtlSeconds = 30 * 24 * 60 * 60;

function isAllowedOrigin(origin) {
  if (!origin) {
    return false;
  }

  try {
    return allowedOrigins.has(normalizeOrigin(origin));
  } catch {
    return false;
  }
}

function getSessionCookieOptions({ persistent = true } = {}) {
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
  };

  if (persistent) {
    options.maxAge = jwtTtlSeconds * 1000;
  }

  return options;
}

function getRefreshCookieOptions(maxAgeSeconds = rememberTtlSeconds) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
    maxAge: Math.max(0, maxAgeSeconds) * 1000,
  };
}

module.exports = {
  allowedOrigins,
  frontendUrl,
  getRefreshCookieOptions,
  getSessionCookieOptions,
  isAllowedOrigin,
  isProduction,
  jwtAudience: process.env.JWT_AUDIENCE || "teca-web",
  jwtIssuer: process.env.JWT_ISSUER || "teca-api",
  jwtSecret,
  jwtTtlSeconds,
  refreshCookieName,
  rememberTtlSeconds,
  sessionCookieName,
};
