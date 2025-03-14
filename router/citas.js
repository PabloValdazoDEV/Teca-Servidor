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
  } = req.body;

  const timeN = Number(time);

  const startDateTime = new Date(citaDate);
  const endDateTime = new Date(startDateTime.getTime() + timeN * 60000);

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

    const overlappingAppointment = await prisma.date.findFirst({
      where: {
        userId,
        OR: [
          {
            AND: [
              { citaDate: { lt: endDateTime } },
              {
                citaDate: {
                  gte: startDateTime,
                },
              },
            ],
          },
          {
            AND: [
              { citaDate: { lte: startDateTime } },
              {
                citaDate: {
                  gt: new Date(startDateTime.getTime() - timeN * 60000),
                },
              },
            ],
          },
        ],
      },
    });

    if (overlappingAppointment) {
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

router.post("/update", authMiddleware, async (req, res) => {
  // console.log(req.body);

  const { dateId, citaDate, userId, time, dateAdvance, message, customer, dateObservation  } =
    req.body;

  try {
    const changeDate = await prisma.date.findUnique({
      where: { id: dateId },
      select: { citaDate: true },
    });
    await prisma.date.update({
      where: {
        id: dateId,
      },
      data: {
        userId,
        time: +time,
        advance_date: dateAdvance ? "TRUE" : "FALSE",
        citaDate: new Date(citaDate),
        dateObservation
      },
    });
    res.json({ message: "Cita editada correctamente" });

    console.log(changeDate)

    // await sendSms(customerPhone, message);

    // console.log("Sms Enviado Cita editada");
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get('/users', authMiddleware, async (req, res)=>{
  try {
    const response = await prisma.user.findMany({
      select:{
        name: true,
        lastName: true,
        id: true
      }
    })
    console.log(response)
    res.send(response)
    
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
})

module.exports = router;
