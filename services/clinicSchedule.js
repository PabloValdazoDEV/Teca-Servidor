const { DateTime } = require("luxon");

const DEFAULT_HOURS = [
  { weekday: 0, enabled: false },
  { weekday: 1, enabled: true, firstStart: "10:00", firstEnd: "14:00", secondStart: "16:00", secondEnd: "22:00" },
  { weekday: 2, enabled: true, firstStart: "10:00", firstEnd: "14:00", secondStart: "16:00", secondEnd: "22:00" },
  { weekday: 3, enabled: true, firstStart: "10:00", firstEnd: "14:00", secondStart: "16:00", secondEnd: "22:00" },
  { weekday: 4, enabled: true, firstStart: "10:00", firstEnd: "14:00", secondStart: "16:00", secondEnd: "22:00" },
  { weekday: 5, enabled: true, firstStart: "10:00", firstEnd: "16:00" },
  { weekday: 6, enabled: false },
];

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function timeToMinutes(value) {
  if (!TIME_PATTERN.test(value || "")) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeDay(input) {
  const weekday = Number(input?.weekday);
  const enabled = input?.enabled === true;

  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error("INVALID_CLINIC_HOURS");
  }

  if (!enabled) {
    return {
      weekday,
      enabled: false,
      firstStart: null,
      firstEnd: null,
      secondStart: null,
      secondEnd: null,
    };
  }

  const firstStart = String(input.firstStart || "");
  const firstEnd = String(input.firstEnd || "");
  const secondStart = input.secondStart ? String(input.secondStart) : null;
  const secondEnd = input.secondEnd ? String(input.secondEnd) : null;
  const firstStartMinutes = timeToMinutes(firstStart);
  const firstEndMinutes = timeToMinutes(firstEnd);

  if (
    firstStartMinutes === null ||
    firstEndMinutes === null ||
    firstStartMinutes >= firstEndMinutes
  ) {
    throw new Error("INVALID_CLINIC_HOURS");
  }

  if ((secondStart && !secondEnd) || (!secondStart && secondEnd)) {
    throw new Error("INVALID_CLINIC_HOURS");
  }

  if (secondStart && secondEnd) {
    const secondStartMinutes = timeToMinutes(secondStart);
    const secondEndMinutes = timeToMinutes(secondEnd);

    if (
      secondStartMinutes === null ||
      secondEndMinutes === null ||
      secondStartMinutes >= secondEndMinutes ||
      secondStartMinutes < firstEndMinutes
    ) {
      throw new Error("INVALID_CLINIC_HOURS");
    }
  }

  return {
    weekday,
    enabled: true,
    firstStart,
    firstEnd,
    secondStart,
    secondEnd,
  };
}

function normalizeHours(hours) {
  if (!Array.isArray(hours) || hours.length !== 7) {
    throw new Error("INVALID_CLINIC_HOURS");
  }

  const normalized = hours.map(normalizeDay).sort((a, b) => a.weekday - b.weekday);
  if (new Set(normalized.map((day) => day.weekday)).size !== 7) {
    throw new Error("INVALID_CLINIC_HOURS");
  }

  return normalized;
}

function appointmentFitsSchedule({ start, durationMinutes, hours, timeZone = "Europe/Madrid" }) {
  const startDateTime = DateTime.isDateTime(start)
    ? start.setZone(timeZone)
    : DateTime.fromJSDate(start, { zone: timeZone });
  const duration = Number(durationMinutes);

  if (!startDateTime.isValid || !Number.isInteger(duration) || duration < 10 || duration > 480) {
    return false;
  }

  const weekday = startDateTime.weekday % 7;
  const schedule = hours.find((day) => day.weekday === weekday);
  if (!schedule?.enabled) {
    return false;
  }

  const startMinutes = startDateTime.hour * 60 + startDateTime.minute;
  const endMinutes = startMinutes + duration;
  const intervals = [
    [schedule.firstStart, schedule.firstEnd],
    [schedule.secondStart, schedule.secondEnd],
  ];

  return intervals.some(([intervalStart, intervalEnd]) => {
    const from = timeToMinutes(intervalStart);
    const to = timeToMinutes(intervalEnd);
    return from !== null && to !== null && startMinutes >= from && endMinutes <= to;
  });
}

module.exports = {
  DEFAULT_HOURS,
  appointmentFitsSchedule,
  normalizeHours,
  timeToMinutes,
};
