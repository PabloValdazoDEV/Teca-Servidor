const express = require("express");
const router = express.Router();
const prisma = require("../prisma/prisma");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authMiddleware = require("../middelwares/authMiddleware");

router.post("/register", authMiddleware, async (req, res) => {
  const { email, password, name, lastName, role } = req.body;
  const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{7,}$/;
  const passwordClean = password.trim();

  try {
    if (!regex.test(passwordClean) || !email || !password) {
      return res
        .status(400)
        .json({ message: "Invalid email or password format" });
    }

    const hashedPassword = await bcrypt.hash(passwordClean, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        lastName,
        role,
      },
    });

    const token = jwt.sign({ id: user.id, email }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    res.json({ message: "User registered successfully", token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password.trim(), user.password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, email }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    res.json({ message: "Login successful", token });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/logout", authMiddleware, (req, res) => {
  res.json({ message: "Logout successful. Remove token on client side." });
});

router.get("/me", authMiddleware, (req, res) => {
  res.json({ loggedIn: true, user: req.user });
});

module.exports = router;
