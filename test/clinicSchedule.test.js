const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");
const {
  DEFAULT_HOURS,
  appointmentFitsExtendedSchedule,
  appointmentFitsSchedule,
  normalizeHours,
} = require("../services/clinicSchedule");

test("appointments must fit completely inside one clinic interval", () => {
  const mondayMorning = DateTime.fromISO("2026-08-24T13:30:00", { zone: "Europe/Madrid" });
  assert.equal(appointmentFitsSchedule({ start: mondayMorning, durationMinutes: 30, hours: DEFAULT_HOURS }), true);
  assert.equal(appointmentFitsSchedule({ start: mondayMorning, durationMinutes: 60, hours: DEFAULT_HOURS }), false);
});

test("clinic hours reject overlapping morning and afternoon intervals", () => {
  const invalid = DEFAULT_HOURS.map((day) => ({ ...day }));
  invalid[1].secondStart = "13:30";
  assert.throws(() => normalizeHours(invalid), /INVALID_CLINIC_HOURS/);
});

test("outside-hours mode adds one hour around the day and allows the break", () => {
  const madrid = { zone: "Europe/Madrid" };
  const fits = (value, durationMinutes = 60) =>
    appointmentFitsExtendedSchedule({
      start: DateTime.fromISO(value, madrid),
      durationMinutes,
      hours: DEFAULT_HOURS,
    });

  assert.equal(fits("2026-08-24T09:00:00"), true);
  assert.equal(fits("2026-08-24T08:45:00"), false);
  assert.equal(fits("2026-08-24T14:30:00"), true);
  assert.equal(fits("2026-08-24T22:00:00"), true);
  assert.equal(fits("2026-08-24T22:15:00"), false);
  assert.equal(fits("2026-08-23T10:00:00"), false);
});
