const express = require("express");
const router = express.Router();
const authMiddleware = require("../middelwares/authMiddleware");
const prisma = require("../prisma/prisma");

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

const citas = [
  {
    id: 1,
    title: "Paciente: Juan",
    start: "2025-03-04 10:00:00",
    end: addMinutesToDate("2025-03-04 10:00:00", 90),
    trabajador: "1",
  },
  {
    id: 2,
    title: "Paciente: Ana",
    start: "2025-03-04 11:00:00",
    end: "2025-03-04 12:00:00",
    trabajador: "2",
  },
  {
    id: 3,
    title: "Paciente: Carlos",
    start: "2025-03-03 12:02:00",
    end: "2025-03-03 13:02:00",
    trabajador: "1",
  },
];

router.post("/calendario", authMiddleware, async (req, res) => {
  const { citaDate, userId, customerId, time } = req.body;

  const startDateTime = new Date(citaDate);
  const endDateTime = new Date(startDateTime.getTime() + time * 60000);

  try {
    if (!citaDate || !userId || !customerId || !time) {
      return res.status(500).json({ message: "Server error" });
    }

    const customeDate = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customeDate) {
      return res.status(500).json({ message: "Customer not find" });
    }

    const overlappingAppointment = await prisma.date.findFirst({
      where: {
        userId,
        AND: [
          {
            citaDate: {
              lte: endDateTime,
            },
          },
          {
            citaDate: {
              gte: startDateTime,
            },
          },
        ],
      },
    });

    if (overlappingAppointment) {
      return res.status(500).json({ message: "Ya hay una cita a esa hora" });
    }

    await prisma.date.create({
      data: {
        citaDate: new Date(citaDate),
        userId,
        customerId,
        time,
      },
    });
    console.log("Cita creada");
    res.json({ Status: "Petición hecha" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/calendario", async (req, res) => {
  const { trabajador } = req.query;

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
      start:addMinutesToDate(convertToISOString(citaDate), 0),
      end: addMinutesToDate(convertToISOString(citaDate), time),
      advance_date: advance_date,
      dateObservation: dateObservation,
    };
  });

  res.json(dataDate);
});

module.exports = router;
