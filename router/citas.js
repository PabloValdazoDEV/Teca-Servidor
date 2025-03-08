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

router.post("/dateCreate", authMiddleware, async (req, res) => {
  const { citaDate, userId, customerId, time, dateObservation, dateAdvance } =
    req.body;
  const timeN = Number(time);

  const startDateTime = new Date(citaDate);
  const endDateTime = new Date(startDateTime.getTime() + timeN * 60000);

  try {
    if (!citaDate || !userId || !customerId || !timeN) {
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
        time: timeN,
        dateObservation,
        advance_date: dateAdvance ? "TRUE" : "FALSE",
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
      include:{
        customer:true
      }
    });
    res.send(dataDatesUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/delete/:id", authMiddleware, async (req, res)=>{
  const {id} = req.params
  try {
    await prisma.date.delete({
      where:{
        id
      }
    })
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }

})

module.exports = router;
