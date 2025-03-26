const express = require("express");
const router = express.Router();

const auth = require("./auth");
const citas = require("./citas");
const customers = require("./customers");

router.use("/citas", citas)
router.use("/customers", customers)
router.use("/", auth);

module.exports = router;
