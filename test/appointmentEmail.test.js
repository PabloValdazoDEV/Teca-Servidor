const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAppointmentCreatedEmail,
  buildAppointmentRescheduledEmail,
} = require("../services/appointmentEmail");

test("confirmation email renders the appointment in Madrid time", () => {
  const email = buildAppointmentCreatedEmail({
    customerName: "María García",
    startDate: new Date("2026-09-02T16:30:00.000Z"),
    durationMinutes: 60,
  });

  assert.equal(email.subject, "Tu cita en TECA · 2 de septiembre, 18:30");
  assert.match(email.text, /Miércoles, 2 de septiembre de 2026/);
  assert.match(email.text, /Hora: 18:30–19:30/);
  assert.match(email.text, /Duración: 1 hora/);
  assert.match(email.html, /CITA CONFIRMADA/);
  assert.match(email.html, /18:30–19:30/);
  assert.match(email.html, /Hola, María\./);
});

test("rescheduled email clearly distinguishes the new and previous dates", () => {
  const email = buildAppointmentRescheduledEmail({
    customerName: "Pablo",
    previousDate: new Date("2026-08-31T08:00:00.000Z"),
    startDate: new Date("2026-09-03T15:00:00.000Z"),
    durationMinutes: 45,
  });

  assert.equal(
    email.subject,
    "Tu cita en TECA ha cambiado · 3 de septiembre, 17:00"
  );
  assert.match(email.html, /NUEVA FECHA/);
  assert.match(email.html, /Cita anterior/);
  assert.match(email.html, /17:00–17:45/);
  assert.match(email.text, /Nueva fecha: Jueves, 3 de septiembre de 2026/);
  assert.match(email.text, /Cita anterior: Lunes, 31 de agosto de 2026 · 10:00/);
});

test("dynamic customer data is escaped in appointment HTML", () => {
  const email = buildAppointmentCreatedEmail({
    customerName: "María<script>alert('x')</script>",
    startDate: new Date("2026-09-02T16:30:00.000Z"),
    durationMinutes: 30,
  });

  assert.doesNotMatch(email.html, /<script>/i);
  assert.match(email.html, /María&lt;script&gt;alert\(&#039;x&#039;\)&lt;\/script&gt;/);
});

test("appointment HTML is self-contained and has a plain-text alternative", () => {
  const email = buildAppointmentCreatedEmail({
    customerName: "Lucía",
    startDate: new Date("2026-09-02T16:30:00.000Z"),
    durationMinutes: 30,
  });

  assert.doesNotMatch(email.html, /https?:\/\//i);
  assert.doesNotMatch(email.html, /<img\b/i);
  assert.match(email.html, /<html lang="es">/);
  assert.match(email.html, /@media only screen and \(max-width: 620px\)/);
  assert.match(email.text, /Centro de Osteopatía TECA/);
});
