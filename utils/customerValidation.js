const { PhoneKind, PreferredCommunication, Province } = require("@prisma/client");
const { DateTime } = require("luxon");
const { isValidEmail, normalizeEmail } = require("./accountValidation");

const MADRID_TIME_ZONE = "Europe/Madrid";
const preferredCommunicationValues = new Set(
  Object.values(PreferredCommunication)
);
const provinceValues = new Set(Object.values(Province));
const phoneKindValues = new Set(Object.values(PhoneKind));

class CustomerValidationError extends Error {}

function requiredName(value) {
  if (typeof value !== "string") {
    throw new CustomerValidationError("El nombre completo es obligatorio");
  }

  const name = value.trim();
  if (!name || name.length > 200) {
    throw new CustomerValidationError(
      "El nombre completo debe tener entre 1 y 200 caracteres"
    );
  }

  return name;
}

function optionalString(value, fieldName, maxLength = 250) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new CustomerValidationError(`${fieldName} no es válido`);
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new CustomerValidationError(
      `${fieldName} no puede superar ${maxLength} caracteres`
    );
  }

  return normalized;
}

function optionalInteger(value, fieldName, { min = 0, max }) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = Number(value);
  if (
    !Number.isInteger(normalized) ||
    normalized < min ||
    (max !== undefined && normalized > max)
  ) {
    throw new CustomerValidationError(`${fieldName} no es válido`);
  }

  return normalized;
}

function optionalEnum(value, fieldName, allowedValues) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !allowedValues.has(value)) {
    throw new CustomerValidationError(`${fieldName} no es válido`);
  }

  return value;
}

function optionalDate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new CustomerValidationError("La fecha de nacimiento no es válida");
  }

  const parsedDate = DateTime.fromISO(value, { zone: MADRID_TIME_ZONE });
  if (!parsedDate.isValid || parsedDate > DateTime.now().setZone(MADRID_TIME_ZONE)) {
    throw new CustomerValidationError("La fecha de nacimiento no es válida");
  }

  return parsedDate.startOf("day").toJSDate();
}

function optionalEmail(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const email = normalizeEmail(value);
  if (!isValidEmail(email)) {
    throw new CustomerValidationError("El correo electrónico no es válido");
  }

  return email;
}

function normalizePhones(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 10) {
    throw new CustomerValidationError("La lista de teléfonos no es válida");
  }

  let communicationPhoneFound = false;
  const phones = value.map((phone) => {
    const countryCode = String(phone?.countryCode ?? "+34").trim();
    const phoneNumber = String(phone?.phoneNumber ?? "").replace(/[\s-]/g, "");
    const rawValue = optionalString(phone?.rawValue, "El texto original del teléfono", 500);
    const label = optionalString(phone?.label, "La etiqueta del teléfono", 100);
    const kind = optionalEnum(phone?.kind, "El tipo de teléfono", phoneKindValues) || "OTHER";

    if (
      !/^\+\d{1,4}$/.test(countryCode) ||
      (phoneNumber && !/^\d{6,15}$/.test(phoneNumber)) ||
      (!phoneNumber && !rawValue)
    ) {
      throw new CustomerValidationError("Hay un teléfono que no es válido");
    }

    const isCommunicationPhone =
      Boolean(phoneNumber) && phone?.isCommunicationPhone === true && !communicationPhoneFound;
    communicationPhoneFound ||= isCommunicationPhone;

    return {
      countryCode,
      phoneNumber: phoneNumber ? BigInt(phoneNumber) : null,
      kind,
      label,
      rawValue,
      isCommunicationPhone,
    };
  });

  if (phones.some((phone) => phone.phoneNumber) && !communicationPhoneFound) {
    phones.find((phone) => phone.phoneNumber).isCommunicationPhone = true;
  }

  return phones;
}

function normalizeCustomerInput(input = {}) {
  const phones = normalizePhones(input.PhoneNumber);
  const emailAddress = optionalEmail(input.emailAddress);
  const preferredCommunication = optionalEnum(
    input.preferredCommunication,
    "El medio de comunicación",
    preferredCommunicationValues
  );

  if (preferredCommunication === "EMAIL" && !emailAddress) {
    throw new CustomerValidationError(
      "Añade un email para utilizarlo como medio de comunicación"
    );
  }
  if (
    ["WHATSAPP", "SMS", "PHONE"].includes(preferredCommunication) &&
    !phones.some((phone) => phone.phoneNumber)
  ) {
    throw new CustomerValidationError(
      "Añade un teléfono para utilizarlo como medio de comunicación"
    );
  }

  return {
    customer: {
      fullName: requiredName(input.fullName),
      age: optionalInteger(input.age, "La edad", { max: 130 }),
      weight: optionalInteger(input.weight, "El peso", { max: 1000 }),
      height: optionalInteger(input.height, "La altura", { max: 300 }),
      profession: optionalString(input.profession, "La profesión", 200),
      province: optionalEnum(input.province, "La provincia", provinceValues),
      population: optionalString(input.population, "La población", 200),
      cD: optionalInteger(input.cD, "El código postal", { max: 99999 }),
      address: optionalString(input.address, "La dirección", 500),
      emailAddress,
      children: optionalInteger(input.children, "El número de hijos", {
        max: 100,
      }),
      observationChildren: optionalString(
        input.observationChildren,
        "Las observaciones",
        1000
      ),
      dateBirth: optionalDate(input.dateBirth),
      preferredCommunication,
    },
    phones,
  };
}

module.exports = {
  CustomerValidationError,
  normalizeCustomerInput,
};
