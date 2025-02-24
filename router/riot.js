const express = require("express");
const router = express.Router();
const authMiddleware = require("../middelwares/authMiddleware");

require("dotenv").config();

router.get("/account-lol", authMiddleware, async (req, res) => {
  const { gameName, tagLine } = req.body;
  const ACCOUNT_V1 = "riot/account/v1/accounts/by-riot-id";
  const URL = `${process.env.URL_BASE_RIOT}${ACCOUNT_V1}/${gameName}/${tagLine}`;
  try {
    const response = await fetch(URL, {
      method: "GET",
      headers: {
        "X-Riot-Token": process.env.API_KEY_RIOT,
      },
    });
    if (!response.ok) {
      throw new Error(
        `Error en la API de Riot: ${response.status} - ${await response.text()}`
      );
    }
    const json = await response.json();
    res.send(json);
  } catch (error) {
    console.error(error);
  }
});

module.exports = router;


