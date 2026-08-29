const express = require("express");
const authMiddleware = require("../middelwares/authMiddleware");
const preferredCommunications = require("../config/preferredCommunications");
const appointmentCommunications = require("../config/appointmentCommunications");
const sendSms = require("../config/sendSms");

const router = express.Router();

router.use(authMiddleware);

router.get("/", (req, res) => {
  return res.json({
    preferredCommunicationChannels:
      preferredCommunications.getEnabledChannels(),
    appointmentCommunicationsEnabled: appointmentCommunications.isEnabled(),
    twilioEnabled: sendSms.isEnabled(),
  });
});

module.exports = router;
