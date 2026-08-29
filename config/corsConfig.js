const { isAllowedOrigin } = require("./security");

const corsConfig = {
  origin(origin, callback) {
    // Requests without Origin are not browser CORS requests. Authentication still
    // applies to them; CORS must never be used as an authorization mechanism.
    if (!origin || isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    const error = new Error("Origin not allowed by CORS policy");
    error.code = "CORS_NOT_ALLOWED";
    return callback(error);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Accept", "Authorization", "Content-Type"],
  exposedHeaders: ["X-TECA-Exported-At"],
  credentials: true,
  maxAge: 600,
  optionsSuccessStatus: 204,
};

module.exports = corsConfig;
  
