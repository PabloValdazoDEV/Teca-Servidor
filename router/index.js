const express = require("express");
const router = express.Router();

const auth = require("./auth");
const citas = require("./citas");
const customers = require("./customers");
const docs = require("./docs");
const users = require("./users");
const clinic = require("./clinic");
const practitioners = require("./practitioners");
const system = require("./system");
const appConfig = require("./appConfig");

router.use("/citas", citas)
router.use("/customers", customers)
router.use("/docs", docs)
router.use("/users", users)
router.use("/clinic", clinic)
router.use("/practitioners", practitioners)
router.use("/system-status", system)
router.use("/app-config", appConfig)
router.use("/", auth);

module.exports = router;
