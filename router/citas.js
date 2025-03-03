const express = require("express");
const router = express.Router();
const authMiddleware = require("../middelwares/authMiddleware");

require("dotenv").config();

const citas = [
  { id: 1, title: "Paciente: Juan", start: "2025-03-04T10:00:00", end: "2025-03-04T11:00:00", trabajador: "1" },
  { id: 2, title: "Paciente: Ana", start: "2025-03-04T11:00:00", end: "2025-03-04T12:00:00", trabajador: "2" },
  { id: 3, title: "Paciente: Carlos", start: "2025-03-03T12:02:00", end: "2025-03-03T13:02:00", trabajador: "1" },
];

router.get("/calendario", (req, res) => {
  const { trabajador } = req.query;

  if (!trabajador) {
    return res.status(400).json({ error: "Falta el parámetro trabajador" });
  }

  const citasFiltradas = citas.filter((cita) => cita.trabajador === trabajador);

  if (citasFiltradas.length === 0) {
    return res.status(404).json({ message: "No hay citas para este trabajador" });
  }

  res.json(citasFiltradas);
});

module.exports = router;
