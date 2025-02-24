const allowedOrigins = [
    "https://teca.pablovaldazo.es",
    "http://localhost:5173",
  ];
  
  // Aplicar configuración de Cookies
  const corsConfig = {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: "GET, POST, PUT, DELETE, OPTIONS",
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-api-key",
      "Accept",
      "Origin",
      "User-Agent"
    ], 
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204, 
  };
  
  module.exports = corsConfig;
  