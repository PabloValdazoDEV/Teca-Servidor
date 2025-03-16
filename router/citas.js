const express = require("express");
const router = express.Router();
const authMiddleware = require("../middelwares/authMiddleware");
const prisma = require("../prisma/prisma");
const sendSms = require("../config/sendSms");

require("dotenv").config();

function addMinutesToDate(dateString, minutesToAdd) {
  let date = new Date(dateString.replace(" ", "T"));
  date.setMinutes(date.getMinutes() + minutesToAdd);
  let year = date.getFullYear();
  let month = String(date.getMonth() + 1).padStart(2, "0");
  let day = String(date.getDate()).padStart(2, "0");
  let hours = String(date.getHours()).padStart(2, "0");
  let minutes = String(date.getMinutes()).padStart(2, "0");
  let seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function convertToISOString(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error("Invalid date object");
  }
  return date.toISOString();
}

router.post("/sendCommunication", authMiddleware, async (req, res) => {
  const { to, message } = req.body;
  console.log(to, message);
  try {
    const response = await sendSms(to, message);
    res.status(200).json({ success: true, response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/dateCreate", authMiddleware, async (req, res) => {
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
  } = req.body;
  const timeN = Number(time);

  if (!citaDate) {
    return res.status(400).json({ message: "Fecha inválida o no definida" });
  }

  const startDateTime = new Date(
    Math.floor(new Date(citaDate).getTime() / 1000) * 1000
  );
  const endDateTime = new Date(startDateTime.getTime() + timeN * 60000);

  if (isNaN(startDateTime.getTime())) {
    console.error("Fecha inválida:", citaDate);
    return res.status(400).json({ message: "Fecha inválida o malformateada" });
  }

  const dayOfWeek = startDateTime.getDay();

  if (
    (dayOfWeek >= 1 &&
      dayOfWeek <= 4 &&
      (endDateTime.getHours() > 22 ||
        (endDateTime.getHours() === 22 && endDateTime.getMinutes() > 0))) ||
    (dayOfWeek === 5 &&
      (endDateTime.getHours() > 16 ||
        (endDateTime.getHours() === 16 && endDateTime.getMinutes() > 0)))
  ) {
    return res.status(400).json({
      message: `Las citas solo pueden terminar hasta las ${
        dayOfWeek === 5 ? "16:00 los viernes" : "22:00 de lunes a jueves"
      }`,
    });
  }

  try {
    if (!citaDate || !userId || !customerId || !timeN) {
      return res.status(400).json({ message: "Datos incompletos" });
    }

    const customeDate = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customeDate) {
      return res.status(404).json({ message: "Cliente no encontrado" });
    }
    // Verificamos citas anteriores que podrían superponerse
    const previousAppointment = await prisma.date.findFirst({
      where: {
        userId,
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
        userId,
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
        userId,
        customerId,
        time: timeN,
        dateObservation,
        advance_date: dateAdvance ? "TRUE" : "FALSE",
        urgent_date,
      },
    });

    console.log("Cita creada");

    // await sendSms(customerPhone, message);

    // console.log("Sms Enviado");

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
    const trabajadorFind = await prisma.user.findUnique({
      where: { id: trabajador },
    });

    if (!trabajadorFind) {
      return res.status(400).json({ error: "User not find" });
    }

    const citasFiltradas = await prisma.date.findMany({
      where: {
        userId: trabajador,
      },
      include: {
        customer: true,
        user: true,
      },
    });

    if (citasFiltradas.length === 0) {
      return res
        .status(404)
        .json({ message: "No hay citas para este trabajador" });
    }

    const dataDate = citasFiltradas.map((cita) => {
      const { citaDate, advance_date, customer, user, time, dateObservation } =
        cita;

      return {
        userId: user.id,
        userName: user.name,
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

router.get("/createForm", authMiddleware, async (req, res) => {
  try {
    const dataCustomers = await prisma.customer.findMany({});
    const dataUsers = await prisma.user.findMany({});
    res.json({
      dataCustomers: dataCustomers,
      dataUsers: dataUsers,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/createCalendar/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const dataDatesUser = await prisma.date.findMany({
      where: {
        userId: id,
      },
      include: {
        customer: true,
      },
    });
    res.send(dataDatesUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/delete/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.date.delete({
      where: {
        id,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/update", authMiddleware, async (req, res) => {
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
    urgent_date
  } = req.body;

  const timeN = Number(time);

  const startDateTime = new Date(Math.floor(new Date(citaDate).getTime() / 1000) * 1000);
  const endDateTime = new Date(startDateTime.getTime() + timeN * 60000);

  if (isNaN(startDateTime.getTime())) {
    console.error("Fecha inválida:", citaDate);
    return res.status(400).json({ message: "Fecha inválida o malformateada" });
  }

  const dayOfWeek = startDateTime.getDay();

  if (
    (dayOfWeek >= 1 && dayOfWeek <= 4 && (endDateTime.getHours() > 22 || (endDateTime.getHours() === 22 && endDateTime.getMinutes() > 0))) ||
    (dayOfWeek === 5 && (endDateTime.getHours() > 16 || (endDateTime.getHours() === 16 && endDateTime.getMinutes() > 0)))
  ) {
    return res.status(400).json({
      message: `Las citas solo pueden terminar hasta las ${
        dayOfWeek === 5 ? "16:00 los viernes" : "22:00 de lunes a jueves"
      }`,
    });
  }

  try {
    if (!citaDate || !userId || !customerId || !timeN) {
      return res.status(400).json({ message: "Datos incompletos" });
    }

    // Verificar que el cliente exista
    const customeDate = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customeDate) {
      return res.status(404).json({ message: "Cliente no encontrado" });
    }

    // Verificar superposición con citas anteriores
    // Verificar superposición con citas anteriores
const previousAppointment = await prisma.date.findFirst({
  where: {
    userId,
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
    previousAppointment.citaDate.getTime() + previousAppointment.time * 60000
  );

  // Solo detectar conflicto si la cita anterior termina después de que comienza la nueva cita
  if (previousEndTime > startDateTime) {
    return res.status(409).json({ message: "Ya hay una cita a esa hora" });
  }
}

// Verificar superposición con citas siguientes
const nextAppointment = await prisma.date.findFirst({
  where: {
    userId,
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

    // Actualizar la cita
    await prisma.date.update({
      where: {
        id: dateId,
      },
      data: {
        userId,
        time: timeN,
        advance_date: dateAdvance ? "TRUE" : "FALSE",
        citaDate: startDateTime,
        dateObservation,
        urgent_date
      },
    });

    console.log("Cita editada correctamente");
    res.json({ message: "Cita editada correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/users", authMiddleware, async (req, res) => {
  try {
    const response = await prisma.user.findMany({
      select: {
        name: true,
        lastName: true,
        id: true,
      },
    });
    const data = response.map((user) => {
      return {
        id: user.id,
        name: `${user.name} ${user.lastName}`,
      };
    });
    res.send(data);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
