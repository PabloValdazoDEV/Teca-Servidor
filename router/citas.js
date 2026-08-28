require("dotenv").config();

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middelwares/authMiddleware");
const prisma = require("../prisma/prisma");
const sendSms = require("../config/sendSms");
const transporter = require("../config/nodemail");
const {
  buildAppointmentCreatedEmail,
  buildAppointmentRescheduledEmail,
} = require("../services/appointmentEmail");
const { DateTime } = require("luxon");
const { rateLimit } = require("express-rate-limit");
const {
  DEFAULT_HOURS,
  appointmentFitsSchedule,
} = require("../services/clinicSchedule");

router.use(authMiddleware);

const communicationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user.id,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Communication limit reached; try again later" },
});

function addMinutesToDate(dateString, minutesToAdd) {
  const parsedDate = DateTime.fromISO(dateString.replace(" ", "T"), {
    zone: "Europe/Madrid",
  });

  if (!parsedDate.isValid) {
    throw new Error("Fecha inválida o malformateada");
  }

  const updatedDate = parsedDate.plus({ minutes: minutesToAdd });

  return updatedDate.toFormat("yyyy-MM-dd HH:mm:ss");
}

function convertToISOString(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error("Invalid date object");
  }
  return date.toISOString();
}

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

router.post("/sendCommunication", communicationLimiter, async (req, res) => {
  const { to, message } = req.body;

  if (
    typeof to !== "string" ||
    !/^\+[1-9]\d{7,14}$/.test(to) ||
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 600
  ) {
    return res.status(400).json({ message: "Invalid phone number or message" });
  }

  try {
    const response = await sendSms(to, message);
    return res.status(200).json({
      success: true,
      messageId: response.sid,
      status: response.status,
    });
  } catch (error) {
    console.error("SMS delivery failed");
    return res.status(502).json({ success: false, message: "SMS delivery failed" });
  }
});

router.post("/dateCreate", async (req, res) => {
  const {
    citaDate,
    userId,
    customer,
    time,
    dateObservation,
    dateAdvance,
    customerId,
    message,
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
    if (
      !clinic.allowOutsideHours &&
      !appointmentFitsSchedule({
        start: parsedDate,
        durationMinutes: timeN,
        hours: clinic.hours,
        timeZone: clinic.timeZone,
      })
    ) {
      return res.status(400).json({ message: "La cita queda fuera del horario de la clínica" });
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

    if (customeDate.preferredCommunication === "EMAIL" && customeDate.emailAddress) {
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
    } else{
      const phone = customeDate.phones
        .filter(
          (phone) => phone.isCommunicationPhone === true && phone.phoneNumber
        )
        .map((phone) => `${phone.countryCode} ${phone.phoneNumber}`)
        .join(" ");
      // await sendSms(phone, message);
    }

    res.json({ Status: "Cita creada correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/calendario", async (req, res) => {
  const { trabajador } = req.query;

  try {
    if (!trabajador) {
      return res.status(400).json({ error: "Falta el parámetro trabajador" });
    }
    const trabajadorFind = await prisma.practitioner.findUnique({
      where: { id: trabajador },
    });

    if (!trabajadorFind) {
      return res.status(400).json({ error: "User not find" });
    }

    const citasFiltradas = await prisma.date.findMany({
      where: {
        ...practitionerWhere(trabajador, trabajadorFind.userId),
      },
      include: {
        customer: {
          include: {
            phones: true,
          },
        },
        user: true,
        practitioner: true,
      },
    });

    if (citasFiltradas.length === 0) {
      return res
        .status(404)
        .json({ message: "No hay citas para este trabajador" });
    }

    const dataDate = citasFiltradas.map((cita) => {
      const { citaDate, advance_date, customer, practitioner, user, time, dateObservation } =
        cita;

      return {
        userId: practitioner?.id || user.id,
        userName: practitioner?.name || user.name,
        customerName: customer.fullName,
        start: addMinutesToDate(convertToISOString(citaDate), 0),
        end: addMinutesToDate(convertToISOString(citaDate), time),
        advance_date: advance_date,
        dateObservation: dateObservation,
      };
    });

    res.json(dataDate);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/createForm", async (req, res) => {
  try {
    const dataCustomers = await prisma.customer.findMany({
      include: {
        phones: true,
      },
    });

    const sanitizedCustomers = dataCustomers.map((customer) => ({
      ...customer,
      id: customer.id.toString(),
      phones: customer.phones
        .filter((phone) => phone.phoneNumber)
        .map((phone) => ({
          ...phone,
          id: phone.id.toString(),
          phoneNumber: phone.phoneNumber.toString(),
        })),
    }));

    const dataUsers = await prisma.practitioner.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        lastName: true,
      },
    });
    res.json({
      dataCustomers: sanitizedCustomers,
      dataUsers: dataUsers,
      dataPractitioners: dataUsers,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/createCalendar/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const dataDatesUser = await prisma.date.findMany({
      where: {
        OR: [
          { practitionerId: id },
          { practitionerId: null, userId: id },
        ],
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
    message,
    customer,
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
    if (
      !clinic.allowOutsideHours &&
      !appointmentFitsSchedule({
        start: parsedDate,
        durationMinutes: timeN,
        hours: clinic.hours,
        timeZone: clinic.timeZone,
      })
    ) {
      return res.status(400).json({ message: "La cita queda fuera del horario de la clínica" });
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
      if (customeDate.preferredCommunication === "EMAIL" && customeDate.emailAddress) {
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
      } else{
        const phone = customeDate.phones
          .filter(
            (phone) => phone.isCommunicationPhone === true && phone.phoneNumber
          )
          .map((phone) => `${phone.countryCode} ${phone.phoneNumber}`)
          .join(" ");

        // await sendSms(phone, message);
      }
    }

    res.json({ message: "Cita editada correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/users", async (req, res) => {
  try {
    const response = await prisma.practitioner.findMany({
      where: { active: true },
      select: {
        name: true,
        lastName: true,
        id: true,
      },
    });
    const data = response.map((user) => {
      return {
        id: user.id,
        name: `${user.name} ${user.lastName || ""}`.trim(),
      };
    });
    res.send(data);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
