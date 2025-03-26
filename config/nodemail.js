const nodemailer = require("nodemailer");

const user = process.env.USER_GMAIL;
const passwordapp = process.env.PASSWORD_APP;

const transporter = nodemailer.createTransport({
    service: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: user,
      pass: passwordapp,
    },
  });

module.exports = transporter