const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLegacyMatchPlan, normalizedLegacyName } = require("../services/legacyMatching");

test("legacy names match despite accents, punctuation and repeated spaces", () => {
  assert.equal(normalizedLegacyName("  José-María  Muñoz "), "JOSE MARIA MUNOZ");
});

test("only one-to-one name matches are automatic", () => {
  const rows = [{ sourceRow: 6, fullName: "Ana Pérez" }, { sourceRow: 7, fullName: "Ana Perez" }, { sourceRow: 8, fullName: "Luis Gil" }];
  const folders = [{ name: "ANA PEREZ" }, { name: "LUIS GIL" }, { name: "Sin paciente" }];
  const plan = buildLegacyMatchPlan(rows, folders);
  assert.equal(plan.autoMatches.length, 1);
  assert.equal(plan.autoMatches[0].row.fullName, "Luis Gil");
  assert.equal(plan.ambiguous.length, 1);
  assert.equal(plan.unmatchedFolders[0].name, "Sin paciente");
});

test("a unique folder containing only the first surnames can match safely", () => {
  const plan = buildLegacyMatchPlan(
    [{ sourceRow: 10, fullName: "BONI POZO SANCHEZ" }],
    [{ name: "BONI POZO" }]
  );
  assert.equal(plan.autoMatches.length, 1);
});
