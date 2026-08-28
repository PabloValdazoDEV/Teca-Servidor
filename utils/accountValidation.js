const BCRYPT_ROUNDS = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

function isValidPasswordInput(password) {
  if (typeof password !== "string") {
    return false;
  }

  const length = Buffer.byteLength(password, "utf8");
  return length > 0 && length <= 72;
}

function isStrongPassword(password) {
  return isValidPasswordInput(password) && STRONG_PASSWORD_PATTERN.test(password);
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    lastName: user.lastName,
    role: user.role,
  };
}

module.exports = {
  BCRYPT_ROUNDS,
  isStrongPassword,
  isValidEmail,
  isValidPasswordInput,
  normalizeEmail,
  publicUser,
};
