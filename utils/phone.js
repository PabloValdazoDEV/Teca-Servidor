const { findPhoneNumbersInText } = require("libphonenumber-js");

// Interpreta el texto libre de un teléfono ("660190388 / madre", "+44 7911…",
// "91 123 45 67 - 660 19 03 88") y devuelve cada número reconocido con su prefijo
// y la nota que lo acompaña. Sin prefijo se asume España. Los números que no son
// válidos (8 cifras, cifras de más…) no se devuelven: quedan como texto para revisar.
function parsePhoneText(text, defaultCountry = "ES") {
  const raw = String(text ?? "");
  if (!raw.trim()) return { numbers: [], note: null };

  // "0044…" es la forma antigua de escribir "+44…".
  const prepared = raw.replace(/(^|[^\d])00(?=[1-9]\d{6,})/g, "$1+");
  const found = findPhoneNumbersInText(prepared, defaultCountry);
  const numbers = found.map(({ number }) => ({
    countryCode: `+${number.countryCallingCode}`,
    phoneNumber: String(number.nationalNumber),
  }));

  let rest = prepared;
  for (const { startsAt, endsAt } of [...found].reverse()) {
    rest = `${rest.slice(0, startsAt)} ${rest.slice(endsAt)}`;
  }
  const note = rest
    .replace(/[()[\]{}]/g, " ")
    .replace(/^[\s/\-–:,;.|]+|[\s/\-–:,;.|]+$/g, "")
    .replace(/\s*[/\-–|]\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();

  return { numbers, note: note || null };
}

module.exports = { parsePhoneText };
