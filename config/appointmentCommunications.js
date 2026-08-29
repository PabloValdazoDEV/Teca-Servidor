const isEnabled = () =>
  process.env.APPOINTMENT_COMMUNICATIONS_ENABLED === "true";

const shouldSendFor = (appointmentDate, now = new Date()) => {
  const start = appointmentDate instanceof Date
    ? appointmentDate
    : new Date(appointmentDate);
  const reference = now instanceof Date ? now : new Date(now);

  return (
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(reference.getTime()) &&
    start.getTime() >= reference.getTime()
  );
};

module.exports = { isEnabled, shouldSendFor };
