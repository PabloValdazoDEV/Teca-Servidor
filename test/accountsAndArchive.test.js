process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-with-at-least-32-bytes!!";

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const prisma = require("../prisma/prisma");

const origin = "http://localhost:5173";

function tokenFor(id) {
  return jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: "HS256",
    audience: "teca-web",
    expiresIn: 900,
    issuer: "teca-api",
    subject: id,
  });
}

function user(role, extra = {}) {
  return { id: `${role.toLowerCase()}-id`, email: `${role.toLowerCase()}@example.com`, name: "N", lastName: "L", role, ...extra };
}

// Sustituye métodos de prisma durante un test y los restaura al acabar.
function stub(t, target, methods) {
  const originals = {};
  for (const [name, fn] of Object.entries(methods)) {
    originals[name] = target[name];
    target[name] = fn;
  }
  t.after(() => Object.assign(target, originals));
}

test("una cuenta desactivada pierde el acceso aunque tenga sesión abierta", async (t) => {
  const disabled = user("EMPLOYEE", { disabledAt: new Date() });
  stub(t, prisma.user, { findUnique: async () => disabled });

  await request(app).get("/me").set("Cookie", `teca_session=${tokenFor(disabled.id)}`).expect(401);
});

test("una cuenta activa no expone su estado interno en /me", async (t) => {
  const active = user("EMPLOYEE", { disabledAt: null });
  stub(t, prisma.user, { findUnique: async () => active });

  const response = await request(app).get("/me").set("Cookie", `teca_session=${tokenFor(active.id)}`).expect(200);
  assert.equal("disabledAt" in response.body.user, false);
});

test("el login de una cuenta desactivada se rechaza tras validar la contraseña", async (t) => {
  const password = "Valid-password1!";
  const disabled = user("EMPLOYEE", { password: await bcrypt.hash(password, 4), disabledAt: new Date() });
  stub(t, prisma.user, { findUnique: async () => disabled });

  const response = await request(app)
    .post("/login")
    .set("Origin", origin)
    .send({ email: disabled.email, password })
    .expect(403);
  assert.equal(response.body.code, "ACCOUNT_DISABLED");
  assert.equal(response.headers["set-cookie"], undefined);
});

test("una sesión recordada de una cuenta desactivada no se renueva", async (t) => {
  let deleted = false;
  stub(t, prisma.session, {
    findUnique: async () => ({
      id: "s1",
      expiresAt: new Date(Date.now() + 60_000),
      user: user("EMPLOYEE", { disabledAt: new Date() }),
    }),
    delete: async () => { deleted = true; },
    update: async () => { throw new Error("no debe rotarse"); },
  });

  await request(app)
    .post("/refresh")
    .set("Origin", origin)
    .set("Cookie", `teca_remember=${"a".repeat(64)}`)
    .send({})
    .expect(401);
  assert.equal(deleted, true);
});

test("recuperar la contraseña no reactiva a un profesional desactivado", async (t) => {
  stub(t, prisma.user, {
    findFirst: async () => ({ id: "u1", password: await bcrypt.hash("Old-password1!", 4), disabledAt: new Date() }),
  });
  stub(t, prisma, { $transaction: async () => { throw new Error("no debe cambiar nada"); } });

  await request(app)
    .post("/reset-password")
    .set("Origin", origin)
    .send({ token: "c".repeat(64), password: "New-password2!" })
    .expect(400);
});

test("completar una invitación solo activa profesionales invitados", async (t) => {
  let practitionerWhere;
  stub(t, prisma.user, { findFirst: async () => ({ id: "u1", password: await bcrypt.hash("Old-password1!", 4), disabledAt: null }) });
  stub(t, prisma, {
    $transaction: async (callback) => callback({
      user: { updateMany: async () => ({ count: 1 }) },
      session: { deleteMany: async () => {} },
      practitioner: { updateMany: async ({ where }) => { practitionerWhere = where; } },
    }),
  });

  await request(app)
    .post("/reset-password")
    .set("Origin", origin)
    .send({ token: "d".repeat(64), password: "New-password2!" })
    .expect(200);
  assert.deepEqual(practitionerWhere, { userId: "u1", status: "INVITED", active: true });
});

test("desactivar una agenda no toca el acceso de esa persona", async (t) => {
  const admin = user("ADMIN");
  let sessionsTouched = false;
  stub(t, prisma.user, { findUnique: async () => admin });
  stub(t, prisma.practitioner, {
    findUnique: async () => ({ id: "p2", userId: "employee-id", status: "ACTIVE", active: true, user: { role: "EMPLOYEE" } }),
    update: async ({ data }) => ({ id: "p2", ...data }),
  });
  stub(t, prisma.session, { deleteMany: async () => { sessionsTouched = true; } });

  const response = await request(app)
    .put("/practitioners/p2")
    .set("Origin", origin)
    .set("Cookie", `teca_session=${tokenFor(admin.id)}`)
    .send({ name: "Eva", lastName: "G", active: false })
    .expect(200);
  assert.equal(response.body.practitioner.status, "INACTIVE");
  assert.equal(sessionsTouched, false);
});

test("desactivar el acceso cierra sus sesiones; nadie se desactiva a sí mismo", async (t) => {
  const admin = user("ADMIN");
  let target = { id: "employee-id", role: "EMPLOYEE" };
  let revokedUserId;
  let savedData;
  stub(t, prisma.user, { findUnique: async ({ where }) => (where.id === admin.id ? admin : target) });
  stub(t, prisma, {
    $transaction: async (callback) => callback({
      user: { update: async ({ data }) => { savedData = data; return { id: target.id, ...data }; } },
      session: { deleteMany: async ({ where }) => { revokedUserId = where.userId; } },
    }),
  });
  const send = (id, active) => request(app).put(`/users/${id}/access`).set("Origin", origin).set("Cookie", `teca_session=${tokenFor(admin.id)}`).send({ active });

  await send("employee-id", false).expect(200);
  assert.ok(savedData.disabledAt instanceof Date);
  assert.equal(revokedUserId, "employee-id");

  // Nadie puede gestionar su propio acceso (su rol no está entre los que gestiona).
  await send(admin.id, false).expect(404);
  target = { id: "other-admin", role: "ADMIN" };
  await send("other-admin", false).expect(404);
});

test("se puede crear una cuenta sin agenda (recepción)", async (t) => {
  const admin = user("ADMIN");
  let practitionerCreated = false;
  stub(t, prisma.user, { findUnique: async () => admin });
  stub(t, prisma, {
    $transaction: async (callback) => callback({
      user: { create: async ({ data }) => ({ id: "new-user", ...data }) },
      practitioner: { create: async () => { practitionerCreated = true; } },
    }),
  });

  await request(app)
    .post("/register")
    .set("Origin", origin)
    .set("Cookie", `teca_session=${tokenFor(admin.id)}`)
    .send({ email: "recepcion@example.com", password: "Valid-password1!", name: "Lucía", lastName: "Recepción", role: "EMPLOYEE", withAgenda: false })
    .expect(201);
  assert.equal(practitionerCreated, false);
});

test("un empleado no puede archivar pacientes ni ver los archivados", async (t) => {
  const employee = user("EMPLOYEE");
  stub(t, prisma.user, { findUnique: async () => employee });
  const cookie = `teca_session=${tokenFor(employee.id)}`;

  await request(app).post("/customers/c1/archive").set("Origin", origin).set("Cookie", cookie).send({}).expect(403);
  await request(app).post("/customers/c1/restore").set("Origin", origin).set("Cookie", cookie).send({}).expect(403);
  await request(app).get("/customers/all?archived=true").set("Cookie", cookie).expect(403);
});

test("archivar avisa de las citas futuras y solo las cancela si se confirma", async (t) => {
  const admin = user("ADMIN");
  let deletedFuture = false;
  let archivedData;
  stub(t, prisma.user, { findUnique: async () => admin });
  stub(t, prisma.customer, { findUnique: async () => ({ id: "c1", archivedAt: null }) });
  stub(t, prisma.date, { count: async () => 2 });
  stub(t, prisma, {
    $transaction: async (callback) => callback({
      date: { deleteMany: async () => { deletedFuture = true; } },
      customer: { update: async ({ data }) => { archivedData = data; return { id: "c1", archivedAt: data.archivedAt }; } },
    }),
  });
  const cookie = `teca_session=${tokenFor(admin.id)}`;

  const warning = await request(app).post("/customers/c1/archive").set("Origin", origin).set("Cookie", cookie).send({}).expect(409);
  assert.equal(warning.body.futureAppointments, 2);
  assert.equal(deletedFuture, false);

  const done = await request(app)
    .post("/customers/c1/archive")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ cancelFutureAppointments: true })
    .expect(200);
  assert.equal(done.body.cancelledAppointments, 2);
  assert.equal(deletedFuture, true);
  assert.equal(archivedData.archivedById, admin.id);
  assert.ok(archivedData.archivedAt instanceof Date);
});

test("el borrado definitivo de pacientes ya no existe", async (t) => {
  const admin = user("ADMIN");
  stub(t, prisma.user, { findUnique: async () => admin });
  stub(t, prisma.customer, { delete: async () => { throw new Error("no debe borrarse"); } });

  await request(app).delete("/customers/delete/c1").set("Origin", origin).set("Cookie", `teca_session=${tokenFor(admin.id)}`).expect(404);
});

test("las fichas rechazan valoraciones con campos desconocidos o no válidos", async (t) => {
  const employee = user("EMPLOYEE");
  stub(t, prisma.user, { findUnique: async () => employee });
  stub(t, prisma, { $transaction: async () => { throw new Error("no debe guardarse"); } });

  await request(app)
    .put("/docs/ficha/f1")
    .set("Origin", origin)
    .set("Cookie", `teca_session=${tokenFor(employee.id)}`)
    .send({ bodyAssessments: [{ bodyPart: "RODILLA", subBodyPart: "NOPE", description: "x" }] })
    .expect(400);
});

test("el registro de accesos guarda solo acciones conocidas y recorta la IP", async () => {
  const { recordAccess } = require("../services/accessLog");
  let saved;
  const client = { accessLog: { create: async ({ data }) => { saved = data; return data; } } };

  await recordAccess(client, { userId: "u1", action: "VIEW_PATIENT", customerId: "c1", ip: "x".repeat(100) });
  assert.equal(saved.action, "VIEW_PATIENT");
  assert.equal(saved.customerId, "c1");
  assert.equal(saved.ip.length, 64);
  await assert.rejects(recordAccess(client, { userId: "u1", action: "HACK" }));
});

test("solo la administración puede consultar el registro de accesos", async (t) => {
  const employee = user("EMPLOYEE");
  stub(t, prisma.user, { findUnique: async () => employee });

  await request(app).get("/customers/c1/access-log").set("Cookie", `teca_session=${tokenFor(employee.id)}`).expect(403);
});

test("dar acceso a un profesional con agenda enlaza su cuenta en vez de crear otra agenda", async (t) => {
  const admin = user("ADMIN");
  let linkedWhere;
  let practitionerCreated = false;
  stub(t, prisma.user, { findUnique: async () => admin });
  stub(t, prisma, {
    $transaction: async (callback) => callback({
      user: { create: async ({ data }) => ({ id: "new-user", ...data }) },
      practitioner: {
        updateMany: async ({ where }) => { linkedWhere = where; return { count: 1 }; },
        create: async () => { practitionerCreated = true; },
      },
    }),
  });

  await request(app)
    .post("/register")
    .set("Origin", origin)
    .set("Cookie", `teca_session=${tokenFor(admin.id)}`)
    .send({ email: "marcos@example.com", password: "Valid-password1!", name: "Marcos", lastName: "Ruiz", role: "EMPLOYEE", practitionerId: "p-marcos" })
    .expect(201);
  assert.deepEqual(linkedWhere, { id: "p-marcos", userId: null });
  assert.equal(practitionerCreated, false);
});

test("la lista de equipo une agendas y cuentas sin agenda, y solo es para administración", async (t) => {
  const admin = user("ADMIN");
  stub(t, prisma.user, {
    findUnique: async () => admin,
    findMany: async () => [{ id: "recep", email: "r@example.com", name: "Lucía", lastName: "R", role: "EMPLOYEE", disabledAt: null }],
  });
  stub(t, prisma.practitioner, {
    findMany: async () => [{ id: "p1", name: "Marcos", lastName: "Ruiz", email: null, color: "#047857", active: true, status: "SCHEDULE_ONLY", user: null }],
  });

  const response = await request(app).get("/team").set("Cookie", `teca_session=${tokenFor(admin.id)}`).expect(200);
  assert.deepEqual(response.body.people.map((p) => [p.name, Boolean(p.agenda), Boolean(p.account)]), [["Marcos", true, false], ["Lucía", false, true]]);
  assert.equal(response.body.people[1].account.canManageAccess, true);

  const employee = user("EMPLOYEE");
  prisma.user.findUnique = async () => employee;
  await request(app).get("/team").set("Cookie", `teca_session=${tokenFor(employee.id)}`).expect(403);
});
