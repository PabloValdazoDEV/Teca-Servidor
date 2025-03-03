const express = require("express");
const router = express.Router();

const auth = require("./auth");
const citas = require("./citas");

router.use("/citas", citas)
router.use("/", auth);

module.exports = router;
