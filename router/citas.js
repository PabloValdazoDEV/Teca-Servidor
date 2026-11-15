require("dotenv").config();

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middelwares/authMiddleware");
const prisma = require("../prisma/prisma");
const transporter = require("../config/nodemail");
const appointmentCommunications = require("../config/appointmentCommunications");
const preferredCommunications = require("../config/preferredCommunications");
const {
  buildAppointmentCreatedEmail,
  buildAppointmentRescheduledEmail,
} = require("../services/appointmentEmail");
const {
  buildAppointmentCreatedSms,
  buildAppointmentRescheduledSms,
  deliverAppointmentSms,
} = require("../services/appointmentSms");
const { DateTime } = require("luxon");
const {
  DEFAULT_HOURS,
  appointmentFitsExtendedSchedule,
  appointmentFitsSchedule,
} = require("../services/clinicSchedule");

router.use(authMiddleware);

async function getSchedulingContext(practitionerId) {
  const [practitioner, clinic] = await Promise.all([
    prisma.practitioner.findUnique({
      where: { id: practitionerId },
      select: { id: true, userId: true, active: true, name: true, lastName: true },
    }),
    prisma.clinic.findUnique({
      where: { id: "default" },
      include: { hours: { orderBy: { weekday: "asc" } } },
    }),
  ]);

  return {
    practitioner,
    clinic: clinic || {
      id: "default",
      allowOutsideHours: false,
      timeZone: "Europe/Madrid",
      hours: DEFAULT_HOURS,
    },
  };
}

function practitionerWhere(practitionerId, userId) {
  return {
    OR: [
      { practitionerId },
      ...(userId ? [{ practitionerId: null, userId }] : []),
    ],
  };
}

// La ruta /sendCommunication (SMS de texto libre a cualquier número) se ha
// eliminado: los SMS de citas se envían solo desde el flujo de creación/edición.

router.post("/dateCreate", async (req, res) => {
  const {
    citaDate,
    userId,
    customer,
    time,
    dateObservation,
    dateAdvance,
    customerId,
    urgent_date,
    sessionPrice,
  } = req.body;
  const timeN = Number(time);

  if (!citaDate || !Number.isInteger(timeN) || timeN < 10 || timeN > 480) {
    return res.status(400).json({ message: "Fecha inválida o no definida" });
  }

  const parsedDate = DateTime.fromISO(citaDate.replace(" ", "T"), {
    zone: "Europe/Madrid",
  });
  if (!parsedDate.isValid) {
    return res.status(400).json({ message: "Fecha inválida o malformateada" });
  }
  const startDateTime = parsedDate.startOf("minute").toJSDate();
  const isPastAppointment = !appointmentCommunications.shouldSendFor(startDateTime);
  const endDateTime = new Date(startDateTime.getTime() + timeN * 60000);

  if (isNaN(startDateTime.getTime())) {
    console.error("Fecha inválida:", citaDate);
    return res.status(400).json({ message: "Fecha inválida o malformateada" });
  }

  try {
    if (!citaDate || !userId || !customerId || !timeN) {
      return res.status(400).json({ message: "Datos incompletos" });
    }

    const [{ practitioner, clinic }, customeDate] = await Promise.all([
      getSchedulingContext(userId),
      prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        phones: true,
      },
      }),
    ]);
    if (!practitioner?.active) {
      return res.status(404).json({ message: "Profesional no encontrado" });
    }
    if (!customeDate) {
      return res.status(404).json({ message: "Cliente no encontrado" });
    }
    if (customeDate.archivedAt) {
      return res.status(409).json({ message: "El paciente está archivado. Restáuralo para darle citas." });
    }
    const fitsAllowedSchedule = clinic.allowOutsideHours
      ? appointmentFitsExtendedSchedule({
          start: parsedDate,
          durationMinutes: timeN,
          hours: clinic.hours,
          timeZone: clinic.timeZone,
        })
      : appointmentFitsSchedule({
        start: parsedDate,
        durationMinutes: timeN,
        hours: clinic.hours,
        timeZone: clinic.timeZone,
      });
    if (!fitsAllowedSchedule) {
      return res.status(400).json({
        message: clinic.allowOutsideHours
          ? "La cita queda fuera del margen permitido de una hora"
          : "La cita queda fuera del horario de la clínica",
      });
    }
    // Verificamos citas anteriores que podrían superponerse
    const previousAppointment = await prisma.date.findFirst({
      where: {
        ...practitionerWhere(practitioner.id, practitioner.userId),
        citaDate: {
          lt: startDateTime,
        },
      },
      orderBy: {
        citaDate: "desc",
      },
    });

    // Calculamos cuando termina la cita anterior (si existe)
    if (previousAppointment) {
      const previousEndTime = new Date(
        previousAppointment.citaDate.getTime() +
          previousAppointment.time * 60000
      );

      // Si la cita anterior termina después de que comienza nuestra nueva cita, hay superposición
      if (previousEndTime > startDateTime) {
        return res.status(409).json({ message: "Ya hay una cita a esa hora" });
      }
    }

    // Verificamos si hay una cita que comienza durante nuestra nueva cita
    const nextAppointment = await prisma.date.findFirst({
      where: {
        ...practitionerWhere(practitioner.id, practitioner.userId),
        citaDate: {
          gte: startDateTime,
          lt: endDateTime,
        },
      },
    });

    if (nextAppointment) {
      return res.status(409).json({ message: "Ya hay una cita a esa hora" });
    }

    await prisma.date.create({
      data: {
        citaDate: startDateTime,
        userId: practitioner.userId || req.user.id,
        practitionerId: practitioner.id,
        customerId,
        time: timeN,
        dateObservation,
        advance_date: dateAdvance ? "TRUE" : "FALSE",
        urgent_date,
        sessionPrice: +sessionPrice,
      },
    });

    console.log("Cita creada");
    if (
      !isPastAppointment &&
      appointmentCommunications.isEnabled() &&
      preferredCommunications.isEnabled("EMAIL") &&
      customeDate.preferredCommunication === "EMAIL" &&
      customeDate.emailAddress
    ) {
      const email = buildAppointmentCreatedEmail({
        customerName: customeDate.fullName,
        startDate: startDateTime,
        durationMinutes: timeN,
      });
      const mailOptions = {
        from: `"Centro de Osteopatía TECA" <${process.env.USER_GMAIL}>`,
        to: customeDate.emailAddress,
        ...email,
      };

      transporter.sendMail(mailOptions).catch(() => {
        console.error("Email delivery failed");
      });
    } else if (
      !isPastAppointment &&
      appointmentCommunications.isEnabled() &&
      preferredCommunications.isEnabled("SMS") &&
      customeDate.preferredCommunication === "SMS"
    ) {
      const sms = buildAppointmentCreatedSms({
        customerName: customeDate.fullName,
        startDate: startDateTime,
      });
      await deliverAppointmentSms({ customer: customeDate, message: sms });
    }

    res.json({
      Status: "Cita creada correctamente",
      communicationSkipped: isPastAppointment,
      communicationSkippedReason: isPastAppointment ? "PAST_APPOINTMENT" : null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/createCalendar/:id", async (req, res) => {
  const { id } = req.params;
  // Rango opcional (?from=&to= en ISO): la agenda pide solo las semanas visibles
  // en lugar de todo el histórico del profesional.
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;
  const hasRange = from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from < to;
  if ((req.query.from || req.query.to) && !hasRange) {
    return res.status(400).json({ message: "Rango de fechas no válido" });
  }
  if (hasRange && to.getTime() - from.getTime() > 400 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ message: "El rango de fechas es demasiado amplio" });
  }
  try {
    const dataDatesUser = await prisma.date.findMany({
      where: {
        OR: [
          { practitionerId: id },
          { practitionerId: null, userId: id },
        ],
        // Margen de un día: incluye citas que empiezan antes y terminan dentro.
        ...(hasRange
          ? { citaDate: { gte: new Date(from.getTime() - 24 * 60 * 60 * 1000), lt: to } }
          : {}),
      },
      include: {
        customer: {
          include: {
            phones: true,
          },
        },
        practitioner: true,
      },
    });

    const sanitizedResponse = dataDatesUser.map((cita) => ({
      ...cita,
      customer: {
        ...cita.customer,
        phones: cita.customer.phones.map((phone) => ({
          ...phone,
          phoneNumber: phone.phoneNumber?.toString() || null,
        })),
      },
    }));
    res.send(sanitizedResponse);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/delete/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.date.delete({
      where: {
        id,
      },
    });
    res.json({ message: "Cita eliminada correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/update", async (req, res) => {
  const {
    dateId,
    citaDate,
    userId,
    time,
    dateAdvance,
    dateObservation,
    customerId,
    urgent_date,
    sessionPrice,
  } = req.body;

  const timeN = Number(time);

  if (!Number.isInteger(timeN) || timeN < 10 || timeN > 480) {
    return res.status(400).json({ message: "La duración de la cita no es válida" });
  }

  const parsedDate = DateTime.fromISO(citaDate.replace(" ", "T"), {
    zone: "Europe/Madrid",
  });
  if (!parsedDate.isValid) {
    return res.status(400).json({ message: "Fecha inválida o malformateada" });
  }
  const startDateTime = parsedDate.startOf("minute").toJSDate();
  const isPastAppointment = !appointmentCommunications.shouldSendFor(startDateTime);
  const endDateTime = new Date(startDateTime.getTime() + timeN * 60000);

  if (isNaN(startDateTime.getTime())) {
    console.error("Fecha inválida:", citaDate);
    return res.status(400).json({ message: "Fecha inválida o malformateada" });
  }

  try {
    if (!citaDate || !userId || !customerId || !timeN) {
      return res.status(400).json({ message: "Datos incompletos" });
    }

    // Verificar que el cliente exista
    const [{ practitioner, clinic }, customeDate] = await Promise.all([
      getSchedulingContext(userId),
      prisma.customer.findUnique({
        where: { id: customerId },
        include: { phones: true },
      }),
    ]);
    if (!practitioner?.active) {
      return res.status(404).json({ message: "Profesional no encontrado" });
    }
    if (!customeDate) {
      return res.status(404).json({ message: "Cliente no encontrado" });
    }
    if (customeDate.archivedAt) {
      return res.status(409).json({ message: "El paciente está archivado. Restáuralo para darle citas." });
    }
    const fitsAllowedSchedule = clinic.allowOutsideHours
      ? appointmentFitsExtendedSchedule({
          start: parsedDate,
          durationMinutes: timeN,
          hours: clinic.hours,
          timeZone: clinic.timeZone,
        })
      : appointmentFitsSchedule({
        start: parsedDate,
        durationMinutes: timeN,
        hours: clinic.hours,
        timeZone: clinic.timeZone,
      });
    if (!fitsAllowedSchedule) {
      return res.status(400).json({
        message: clinic.allowOutsideHours
          ? "La cita queda fuera del margen permitido de una hora"
          : "La cita queda fuera del horario de la clínica",
      });
    }

    // Verificar superposición con citas anteriores
    // Verificar superposición con citas anteriores
    const previousAppointment = await prisma.date.findFirst({
      where: {
        ...practitionerWhere(practitioner.id, practitioner.userId),
        id: { not: dateId }, // Excluimos la cita actual de la verificación
        citaDate: {
          lt: startDateTime, // Citas que comienzan antes de la nueva cita
        },
      },
      orderBy: {
        citaDate: "desc",
      },
    });

    if (previousAppointment) {
      const previousEndTime = new Date(
        previousAppointment.citaDate.getTime() +
          previousAppointment.time * 60000
      );

      // Solo detectar conflicto si la cita anterior termina después de que comienza la nueva cita
      if (previousEndTime > startDateTime) {
        return res.status(409).json({ message: "Ya hay una cita a esa hora" });
      }
    }

    // Verificar superposición con citas siguientes
    const nextAppointment = await prisma.date.findFirst({
      where: {
        ...practitionerWhere(practitioner.id, practitioner.userId),
        id: { not: dateId }, // Excluimos la cita actual de la verificación
        citaDate: {
          gte: startDateTime, // Citas que comienzan después o al mismo tiempo que la nueva cita
          lt: endDateTime, // Citas que comienzan antes de que termine la nueva cita
        },
      },
    });
    if (nextAppointment) {
      return res.status(409).json({ message: "Ya hay una cita a esa hora" });
    }

    const fechaActual = await prisma.date.findUnique({
      where: {
        id: dateId,
      },
      select: {
        citaDate: true,
      },
    });

    // Actualizar la cita
    await prisma.date.update({
      where: {
        id: dateId,
      },
      data: {
        userId: practitioner.userId || req.user.id,
        practitionerId: practitioner.id,
        time: timeN,
        advance_date: dateAdvance ? "TRUE" : "FALSE",
        citaDate: startDateTime,
        dateObservation,
        urgent_date,
        sessionPrice: +sessionPrice,
      },
    });
    console.log("Cita editada correctamente");
    if (fechaActual.citaDate.getTime() !== startDateTime.getTime()) {
      if (
        !isPastAppointment &&
        appointmentCommunications.isEnabled() &&
        preferredCommunications.isEnabled("EMAIL") &&
        customeDate.preferredCommunication === "EMAIL" &&
        customeDate.emailAddress
      ) {
        const email = buildAppointmentRescheduledEmail({
          customerName: customeDate.fullName,
          previousDate: fechaActual.citaDate,
          startDate: startDateTime,
          durationMinutes: timeN,
        });
        const mailOptions = {
          from: `"Centro de Osteopatía TECA" <${process.env.USER_GMAIL}>`,
          to: customeDate.emailAddress,
          ...email,
        };

        transporter.sendMail(mailOptions).catch(() => {
          console.error("Email delivery failed");
        });
      } else if (
        !isPastAppointment &&
        appointmentCommunications.isEnabled() &&
        preferredCommunications.isEnabled("SMS") &&
        customeDate.preferredCommunication === "SMS"
      ) {
        const sms = buildAppointmentRescheduledSms({
          customerName: customeDate.fullName,
          startDate: startDateTime,
        });
        await deliverAppointmentSms({ customer: customeDate, message: sms });
      }
    }

    res.json({
      message: "Cita editada correctamente",
      communicationSkipped: isPastAppointment,
      communicationSkippedReason: isPastAppointment ? "PAST_APPOINTMENT" : null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
