require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const app = express();
const PORT = process.env.PORT || 3000;
const BIND_HOST = process.env.BIND_HOST || "127.0.0.1";
const router = require("./router");
const corsConfig = require("./config/corsConfig");
const { isProduction } = require("./config/security");

app.disable("x-powered-by");

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-site" },
    hsts: isProduction
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  })
);
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(cors(corsConfig));
app.options("*", cors(corsConfig));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS",
    message: { message: "Too many requests; try again later" },
  })
);

const methodsWithBody = new Set(["POST", "PUT", "PATCH"]);
app.use((req, res, next) => {
  const hasBody = req.get("Content-Length") !== undefined || req.get("Transfer-Encoding");

  if (
    methodsWithBody.has(req.method) &&
    hasBody &&
    !req.is(["application/json", "application/*+json", "multipart/form-data"])
  ) {
    return res.status(415).json({ message: "Content-Type must be application/json" });
  }

  return next();
});

app.use(express.json({ limit: "64kb", strict: true }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.body === undefined) {
    req.body = {};
  }

  next();
});

app.use("/", router);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.code === "CORS_NOT_ALLOWED") {
    return res.status(403).json({ message: "Origin not allowed" });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body too large" });
  }

  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: "El archivo no puede superar 25 MB" });
  }

  if (error.name === "MulterError") {
    return res.status(400).json({ message: "La subida del archivo no es válida" });
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ message: "Malformed JSON body" });
  }

  console.error("Unhandled request error", error);
  return res.status(500).json({ message: "Internal server error" });
});

if (require.main === module) {
  app.listen(PORT, BIND_HOST, () => {
    console.log(`El servidor está escuchando en ${BIND_HOST}:${PORT}`);
  });
}

module.exports = app;
