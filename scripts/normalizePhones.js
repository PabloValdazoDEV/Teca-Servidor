require("dotenv").config();

// Repara los teléfonos guardados solo como texto (importaciones antiguas) o con un
// prefijo equivocado (números extranjeros guardados como +34).
//   npm run phones:plan   → simula y genera un informe, sin tocar nada
//   npm run phones:apply  → aplica los cambios
const fs = require("node:fs/promises");
const path = require("node:path");
const prisma = require("../prisma/prisma");
const { parsePhoneText } = require("../utils/phone");

const applyChanges = process.argv.includes("--apply");
const reportDirectory = path.join(__dirname, "..", "migration-reports");

// Decide qué hacer con un teléfono guardado. Devuelve null si ya está bien.
function planPhoneFix(phone) {
  if (!phone.rawValue) return null;
  const { numbers } = parsePhoneText(phone.rawValue);
  const stored = phone.phoneNumber == null ? null : String(phone.phoneNumber);
  const explicitPrefix = /^\s*(\+|00)/.test(phone.rawValue);

  if (!numbers.length) {
    return stored ? null : { action: "review" };
  }
  const [first, ...extra] = numbers;
  const needsUpdate =
    stored === null ||
    (explicitPrefix && (first.countryCode !== phone.countryCode || first.phoneNumber !== stored));
  if (!needsUpdate) return null;
  return { action: "update", first, extra: stored === null ? extra : [] };
}

async function main() {
  const phones = await prisma.phoneNumber.findMany({
    where: { rawValue: { not: null } },
    select: { id: true, customerId: true, countryCode: true, phoneNumber: true, kind: true, label: true, rawValue: true },
  });

  const report = { generatedAt: new Date().toISOString(), mode: applyChanges ? "apply" : "dry-run", checked: phones.length, updated: 0, extraPhonesCreated: 0, toReview: [] };

  for (const phone of phones) {
    const fix = planPhoneFix(phone);
    if (!fix) continue;
    if (fix.action === "review") {
      report.toReview.push({ phoneId: phone.id, customerId: phone.customerId, rawValue: phone.rawValue });
      continue;
    }
    report.updated += 1;
    report.extraPhonesCreated += fix.extra.length;
    if (!applyChanges) continue;
    await prisma.$transaction([
      prisma.phoneNumber.update({
        where: { id: phone.id },
        data: { countryCode: fix.first.countryCode, phoneNumber: BigInt(fix.first.phoneNumber) },
      }),
      ...fix.extra.map((number, index) => prisma.phoneNumber.create({
        data: {
          customerId: phone.customerId,
          kind: phone.kind,
          label: `${phone.label || "Teléfono"} ${index + 2}`,
          rawValue: phone.rawValue,
          countryCode: number.countryCode,
          phoneNumber: BigInt(number.phoneNumber),
        },
      })),
    ]);
  }

  await fs.mkdir(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, `phones-${report.mode}-${report.generatedAt.replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ reportPath, mode: report.mode, checked: report.checked, updated: report.updated, extraPhonesCreated: report.extraPhonesCreated, toReview: report.toReview.length }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => prisma.$disconnect());
}

module.exports = { planPhoneFix };
