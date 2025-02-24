const express = require("express");
const router = express.Router();

const auth = require("./auth");
const riot = require("./riot");

router.use("/riot", riot)
router.use("/", auth);

module.exports = router;
