process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-with-at-least-32-bytes!!";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const prisma = require("../prisma/prisma");
const transporter = require("../config/nodemail");

const allowedOrigin = "http://localhost:5173";

test("allowed preflight returns an exact credentialed CORS origin", async () => {
  const response = await request(app)
    .options("/me")
    .set("Origin", allowedOrigin)
    .set("Access-Control-Request-Method", "GET")
    .expect(204);

  assert.equal(response.headers["access-control-allow-origin"], allowedOrigin);
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  assert.notEqual(response.headers["access-control-allow-origin"], "*");
});

test("disallowed origins are rejected", async () => {
  const response = await request(app)
    .get("/me")
    .set("Origin", "https://attacker.example")
    .expect(403);

  assert.equal(response.body.message, "Origin not allowed");
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});

test("an allowed Origin never bypasses authentication", async () => {
  await request(app)
    .get("/citas/calendario?trabajador=someone")
    .set("Origin", allowedOrigin)
    .expect(401);
});

test("the former API key bypass is rejected", async () => {
  await request(app)
    .get("/customers/all")
    .set("Origin", allowedOrigin)
    .set("x-api-key", "previously-trusted-key")
    .expect(401);
});

test("malformed bearer authentication is rejected", async () => {
  await request(app)
    .get("/me")
    .set("Authorization", "Basic abc123")
    .expect(401);
});

test("state-changing form submissions require JSON", async () => {
  await request(app)
    .post("/login")
    .set("Origin", allowedOrigin)
    .type("form")
    .send({ email: "person@example.com", password: "password" })
    .expect(415);
});

test("security headers are enabled and framework fingerprinting is disabled", async () => {
  const response = await request(app).get("/missing").expect(404);

  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("login uses an HttpOnly cookie and does not expose the JWT in JSON", async (t) => {
  const originalFindUnique = prisma.user.findUnique;
  const password = "Valid-password1!";
  const passwordHash = await bcrypt.hash(password, 4);

  prisma.user.findUnique = async () => ({
    id: "aebd9f4d-1008-444e-8028-430e88673f8e",
    email: "person@example.com",
    name: "Test",
    lastName: "User",
    password: passwordHash,
    role: "EMPLOYEE",
  });
  t.after(() => {
    prisma.user.findUnique = originalFindUnique;
  });

  const response = await request(app)
    .post("/login")
    .set("Origin", allowedOrigin)
    .send({ email: "PERSON@example.com", password })
    .expect(200);

  const sessionCookie = response.headers["set-cookie"].find((cookie) =>
    cookie.startsWith("teca_session=")
  );

  assert.ok(sessionCookie.includes("HttpOnly"));
  assert.ok(sessionCookie.includes("SameSite=Strict"));
  assert.equal(response.body.token, undefined);
  assert.equal(response.body.user.email, "person@example.com");
});

test("JWT claims, current user lookup, roles and cookie CSRF are enforced", async (t) => {
  const originalFindUnique = prisma.user.findUnique;
  const currentUser = {
    id: "5d9f4077-0bb0-46f2-bac8-ec643ecb81fb",
    email: "employee@example.com",
    name: "Current",
    lastName: "Employee",
    role: "EMPLOYEE",
  };
  const token = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: "HS256",
    audience: "teca-web",
    expiresIn: 900,
    issuer: "teca-api",
    subject: currentUser.id,
  });

  prisma.user.findUnique = async () => currentUser;
  t.after(() => {
    prisma.user.findUnique = originalFindUnique;
  });

  const meResponse = await request(app)
    .get("/me")
    .set("Cookie", `teca_session=${token}`)
    .expect(200);

  assert.deepEqual(meResponse.body.user, currentUser);
  assert.equal(meResponse.body.user.password, undefined);

  await request(app)
    .post("/register")
    .set("Cookie", `teca_session=${token}`)
    .send({})
    .expect(403);

  await request(app)
    .post("/register")
    .set("Origin", allowedOrigin)
    .set("Cookie", `teca_session=${token}`)
    .send({})
    .expect(403);

  const wrongAlgorithmToken = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: "HS384",
    audience: "teca-web",
    expiresIn: 900,
    issuer: "teca-api",
    subject: currentUser.id,
  });

  await request(app)
    .get("/me")
    .set("Authorization", `Bearer ${wrongAlgorithmToken}`)
    .expect(401);
});

test("remember me creates a revocable 30-day HttpOnly cookie", async (t) => {
  const originalFindUnique = prisma.user.findUnique;
  const originalTransaction = prisma.$transaction;
  const password = "Valid-password1!";
  const passwordHash = await bcrypt.hash(password, 4);
  let createdSession;

  prisma.user.findUnique = async () => ({
    id: "b24cb641-e92e-44f2-98a4-30c09e15d0b7",
    email: "remember@example.com",
    name: "Remembered",
    lastName: "User",
    password: passwordHash,
    role: "EMPLOYEE",
  });
  prisma.$transaction = async (callback) => callback({
    session: {
      create: async ({ data }) => {
        createdSession = data;
      },
      deleteMany: async () => ({ count: 0 }),
      findMany: async () => [],
    },
  });
  t.after(() => {
    prisma.user.findUnique = originalFindUnique;
    prisma.$transaction = originalTransaction;
  });

  const response = await request(app)
    .post("/login")
    .set("Origin", allowedOrigin)
    .send({ email: "remember@example.com", password, rememberMe: true })
    .expect(200);

  const rememberCookie = response.headers["set-cookie"].find((cookie) =>
    cookie.startsWith("teca_remember=")
  );

  assert.ok(rememberCookie.includes("HttpOnly"));
  assert.ok(rememberCookie.includes("SameSite=Strict"));
  assert.ok(rememberCookie.includes("Max-Age=2592000"));
  assert.equal(createdSession.userId, "b24cb641-e92e-44f2-98a4-30c09e15d0b7");
  assert.match(createdSession.tokenHash, /^[a-f0-9]{64}$/);
});

test("remembered sessions rotate without extending their expiry", async (t) => {
  const originalFindUnique = prisma.session.findUnique;
  const originalUpdate = prisma.session.update;
  const oldToken = "a".repeat(64);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  let updateData;

  prisma.session.findUnique = async () => ({
    id: "remembered-session",
    expiresAt,
    user: {
      id: "8fd25f9d-e03c-4c1b-9d4b-a47e922ec213",
      email: "remember@example.com",
      name: "Remembered",
      lastName: "User",
      role: "EMPLOYEE",
    },
  });
  prisma.session.update = async ({ data }) => {
    updateData = data;
  };
  t.after(() => {
    prisma.session.findUnique = originalFindUnique;
    prisma.session.update = originalUpdate;
  });

  const response = await request(app)
    .post("/refresh")
    .set("Origin", allowedOrigin)
    .set("Cookie", `teca_remember=${oldToken}`)
    .send({})
    .expect(200);

  assert.equal(response.body.user.email, "remember@example.com");
  assert.match(updateData.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(updateData.tokenHash, oldToken);
  assert.ok(response.headers["set-cookie"].some((cookie) => cookie.startsWith("teca_session=")));
});

test("forgot password is generic and emails only a hashed one-time token", async (t) => {
  const originalFindUnique = prisma.user.findUnique;
  const originalUpdate = prisma.user.update;
  const originalSendMail = transporter.sendMail;
  let storedData;
  let emailOptions;

  prisma.user.findUnique = async () => ({
    id: "recovery-user",
    email: "recovery@example.com",
  });
  prisma.user.update = async ({ data }) => {
    storedData = data;
  };
  transporter.sendMail = async (options) => {
    emailOptions = options;
  };
  t.after(() => {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.update = originalUpdate;
    transporter.sendMail = originalSendMail;
  });

  const response = await request(app)
    .post("/forgot-password")
    .set("Origin", allowedOrigin)
    .send({ email: "RECOVERY@example.com" })
    .expect(202);

  assert.match(response.body.message, /If the account exists/);
  assert.match(storedData.passwordResetTokenHash, /^[a-f0-9]{64}$/);
  assert.ok(storedData.passwordResetExpiresAt > new Date());
  assert.match(emailOptions.text, /#token=[a-f0-9]{64}/);
  assert.ok(!emailOptions.text.includes(storedData.passwordResetTokenHash));
});

test("password reset consumes its token and revokes remembered sessions", async (t) => {
  const originalFindFirst = prisma.user.findFirst;
  const originalTransaction = prisma.$transaction;
  const oldPasswordHash = await bcrypt.hash("Old-password1!", 4);
  let updateData;
  let revokedUserId;

  prisma.user.findFirst = async () => ({
    id: "reset-user",
    password: oldPasswordHash,
  });
  prisma.$transaction = async (callback) => callback({
    session: {
      deleteMany: async ({ where }) => {
        revokedUserId = where.userId;
      },
    },
    user: {
      updateMany: async ({ data }) => {
        updateData = data;
        return { count: 1 };
      },
    },
  });
  t.after(() => {
    prisma.user.findFirst = originalFindFirst;
    prisma.$transaction = originalTransaction;
  });

  const response = await request(app)
    .post("/reset-password")
    .set("Origin", allowedOrigin)
    .send({ token: "b".repeat(64), password: "New-password2!" })
    .expect(200);

  assert.equal(updateData.passwordResetTokenHash, null);
  assert.equal(updateData.passwordResetExpiresAt, null);
  assert.notEqual(updateData.password, oldPasswordHash);
  assert.equal(revokedUserId, "reset-user");
  assert.ok(response.headers["set-cookie"].some((cookie) => cookie.startsWith("teca_remember=;")));
});

test("admins can edit employees but cannot promote them", async (t) => {
  const originalFindUnique = prisma.user.findUnique;
  const originalFindMany = prisma.user.findMany;
  const originalUpdate = prisma.user.update;
  const admin = {
    id: "admin-user",
    email: "admin@example.com",
    name: "Admin",
    lastName: "User",
    role: "ADMIN",
  };
  const employee = {
    id: "employee-user",
    email: "employee@example.com",
    name: "Employee",
    lastName: "User",
    role: "EMPLOYEE",
  };
  let listWhere;
  let updateData;

  prisma.user.findUnique = async ({ where }) =>
    where.id === admin.id ? admin : employee;
  prisma.user.findMany = async ({ where }) => {
    listWhere = where;
    return [employee];
  };
  prisma.user.update = async ({ data }) => {
    updateData = data;
    return { ...employee, ...data };
  };
  t.after(() => {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.findMany = originalFindMany;
    prisma.user.update = originalUpdate;
  });

  const adminToken = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: "HS256",
    audience: "teca-web",
    expiresIn: 900,
    issuer: "teca-api",
    subject: admin.id,
  });

  await request(app)
    .get("/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .expect(200);
  assert.deepEqual(listWhere.role.in, ["EMPLOYEE"]);

  await request(app)
    .put(`/users/${employee.id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ ...employee, role: "ADMIN" })
    .expect(400);

  await request(app)
    .put(`/users/${employee.id}`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ ...employee, name: "Edited", role: "EMPLOYEE" })
    .expect(200);

  assert.equal(updateData.name, "Edited");
  assert.equal(updateData.role, "EMPLOYEE");
});

test("a failed practitioner email restores the agenda-only profile", async (t) => {
  const originalUserFindUnique = prisma.user.findUnique;
  const originalPractitionerFindUnique = prisma.practitioner.findUnique;
  const originalTransaction = prisma.$transaction;
  const originalSendMail = transporter.sendMail;
  const originalConsoleError = console.error;
  const admin = {
    id: "invitation-admin",
    email: "admin@example.com",
    name: "Admin",
    lastName: "User",
    role: "ADMIN",
  };
  const practitioner = {
    id: "agenda-practitioner",
    userId: null,
    name: "Agenda",
    lastName: "Only",
    email: "old-address@example.com",
    status: "SCHEDULE_ONLY",
  };
  let invitationUpdate;
  let rollbackUpdate;
  let deletedUserWhere;
  let transactionCount = 0;

  prisma.user.findUnique = async () => admin;
  prisma.practitioner.findUnique = async () => practitioner;
  prisma.$transaction = async (callback) => {
    transactionCount += 1;

    if (transactionCount === 1) {
      return callback({
        user: {
          create: async () => ({ id: "temporary-invited-user" }),
        },
        practitioner: {
          update: async ({ data }) => {
            invitationUpdate = data;
          },
        },
      });
    }

    return callback({
      practitioner: {
        updateMany: async (input) => {
          rollbackUpdate = input;
          return { count: 1 };
        },
      },
      user: {
        deleteMany: async ({ where }) => {
          deletedUserWhere = where;
          return { count: 1 };
        },
      },
    });
  };
  transporter.sendMail = async () => {
    throw new Error("SMTP unavailable");
  };
  console.error = () => {};
  t.after(() => {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.practitioner.findUnique = originalPractitionerFindUnique;
    prisma.$transaction = originalTransaction;
    transporter.sendMail = originalSendMail;
    console.error = originalConsoleError;
  });

  const token = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: "HS256",
    audience: "teca-web",
    expiresIn: 900,
    issuer: "teca-api",
    subject: admin.id,
  });

  await request(app)
    .post(`/practitioners/${practitioner.id}/invite`)
    .set("Authorization", `Bearer ${token}`)
    .send({ email: "new-address@example.com" })
    .expect(500);

  assert.deepEqual(invitationUpdate, {
    userId: "temporary-invited-user",
    email: "new-address@example.com",
    status: "INVITED",
  });
  assert.deepEqual(rollbackUpdate.where, {
    id: practitioner.id,
    userId: "temporary-invited-user",
  });
  assert.deepEqual(rollbackUpdate.data, {
    userId: null,
    email: practitioner.email,
    status: "SCHEDULE_ONLY",
  });
  assert.deepEqual(deletedUserWhere, { id: "temporary-invited-user" });
});

test("customer creation accepts a name without optional personal data", async (t) => {
  const originalUserFindUnique = prisma.user.findUnique;
  const originalCustomerCreate = prisma.customer.create;
  const originalDocumentFindMany = prisma.doc.findMany;
  const currentUser = {
    id: "c7656d83-d128-44eb-9a10-b1f739e7e0c4",
    email: "employee@example.com",
    name: "Current",
    lastName: "Employee",
    role: "EMPLOYEE",
  };
  const token = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: "HS256",
    audience: "teca-web",
    expiresIn: 900,
    issuer: "teca-api",
    subject: currentUser.id,
  });
  let customerData;

  prisma.user.findUnique = async () => currentUser;
  prisma.customer.create = async ({ data }) => {
    customerData = data;
    return { id: "new-customer", ...data };
  };
  prisma.doc.findMany = async () => [
    { fixedType: "FICHA" },
    { fixedType: "VISCERAL_CRANEAL" },
    { fixedType: "HISTORIAL_CLINICO" },
  ];
  t.after(() => {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.customer.create = originalCustomerCreate;
    prisma.doc.findMany = originalDocumentFindMany;
  });

  const response = await request(app)
    .post("/customers/create")
    .set("Origin", allowedOrigin)
    .set("Cookie", `teca_session=${token}`)
    .send({ fullName: "  Ana Pérez  " })
    .expect(201);

  assert.equal(response.body.customer.fullName, "Ana Pérez");
  assert.equal(customerData.dateBirth, null);
  assert.equal(customerData.emailAddress, null);
  assert.equal(customerData.phones, undefined);
});

test("customer detail returns the nearest future appointment independently of history", async (t) => {
  const originalUserFindUnique = prisma.user.findUnique;
  const originalCustomerFindUnique = prisma.customer.findUnique;
  const originalDateFindFirst = prisma.date.findFirst;
  const currentUser = {
    id: "5278d4a6-d376-40e3-82fa-2a50c9145f04",
    email: "employee@example.com",
    name: "Current",
    lastName: "Employee",
    role: "EMPLOYEE",
  };
  const token = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: "HS256",
    audience: "teca-web",
    expiresIn: 900,
    issuer: "teca-api",
    subject: currentUser.id,
  });
  const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000);
  let nextAppointmentQuery;

  prisma.user.findUnique = async () => currentUser;
  prisma.customer.findUnique = async () => ({
    id: "customer-with-future-appointment",
    customerNumber: 10,
    fullName: "Paciente con cita",
    phones: [],
    docs: [],
    appointments: [],
  });
  prisma.date.findFirst = async (query) => {
    nextAppointmentQuery = query;
    return {
      id: "next-appointment",
      customerId: "customer-with-future-appointment",
      citaDate: futureDate,
      time: 60,
      practitioner: { id: "practitioner", name: "Pablo" },
      user: null,
    };
  };
  t.after(() => {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.customer.findUnique = originalCustomerFindUnique;
    prisma.date.findFirst = originalDateFindFirst;
  });

  const response = await request(app)
    .get("/customers/detail/customer-with-future-appointment")
    .set("Cookie", `teca_session=${token}`)
    .expect(200);

  assert.equal(response.body.nextAppointment.id, "next-appointment");
  assert.equal(nextAppointmentQuery.where.customerId, "customer-with-future-appointment");
  assert.ok(nextAppointmentQuery.where.citaDate.gte instanceof Date);
  assert.deepEqual(nextAppointmentQuery.orderBy, { citaDate: "asc" });

  prisma.date.findFirst = async () => null;
  const responseWithoutFutureAppointment = await request(app)
    .get("/customers/detail/customer-without-future-appointment")
    .set("Cookie", `teca_session=${token}`)
    .expect(200);

  assert.equal(responseWithoutFutureAppointment.body.nextAppointment, null);
});
