const jwt = require("jsonwebtoken");
const prisma = require("../prisma/prisma");
const {
  isAllowedOrigin,
  jwtAudience,
  jwtIssuer,
  jwtSecret,
  sessionCookieName,
} = require("../config/security");

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getBearerToken(req) {
  const authorization = req.get("Authorization");

  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer ([^\s]+)$/);
  return match ? match[1] : false;
}

function rejectUnauthorized(res) {
  res.set("WWW-Authenticate", 'Bearer realm="teca"');
  return res.status(401).json({ message: "Authentication required" });
}

const authMiddleware = async (req, res, next) => {
  const bearerToken = getBearerToken(req);

  if (bearerToken === false) {
    return rejectUnauthorized(res);
  }

  const cookieToken = req.cookies?.[sessionCookieName];
  const token = bearerToken || cookieToken;
  const authenticationType = bearerToken ? "bearer" : "cookie";

  if (!token) {
    return rejectUnauthorized(res);
  }

  // Cookie authentication requires a trusted browser origin on state-changing
  // requests. This prevents CSRF independently from the CORS response headers.
  if (authenticationType === "cookie" && UNSAFE_METHODS.has(req.method)) {
    const origin = req.get("Origin");
    const fetchSite = req.get("Sec-Fetch-Site");

    if (!isAllowedOrigin(origin) || fetchSite === "cross-site") {
      return res.status(403).json({ message: "Request origin could not be verified" });
    }
  }

  try {
    const payload = jwt.verify(token, jwtSecret, {
      algorithms: ["HS256"],
      audience: jwtAudience,
      issuer: jwtIssuer,
    });

    if (!payload.sub) {
      return rejectUnauthorized(res);
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        role: true,
      },
    });

    if (!user) {
      return rejectUnauthorized(res);
    }

    req.user = user;
    req.authenticationType = authenticationType;
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return rejectUnauthorized(res);
    }

    return next(error);
  }
};

function requireRole(...allowedRoles) {
  const roles = new Set(allowedRoles);

  return (req, res, next) => {
    if (!req.user || !roles.has(req.user.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    return next();
  };
}

authMiddleware.requireRole = requireRole;

module.exports = authMiddleware;
