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

test("the legacy folder column takes priority over a different patient name", () => {
  const plan = buildLegacyMatchPlan(
    [
      { sourceRow: 10, fullName: "Nombre desactualizado", folderHint: "CARPETA CORRECTA" },
      { sourceRow: 11, fullName: "Carpeta Correcta" },
    ],
    [{ name: "CARPETA CORRECTA" }]
  );

  assert.equal(plan.autoMatches.length, 1);
  assert.equal(plan.autoMatches[0].row.sourceRow, 10);
  assert.equal(plan.autoMatches[0].strategy, "folder-column");
});

test("one patient is never assigned automatically to two compatible folders", () => {
  const plan = buildLegacyMatchPlan(
    [{ sourceRow: 10, fullName: "Boni Pozo Sánchez" }],
    [{ name: "BONI POZO" }, { name: "BONI POZO SANCHEZ" }]
  );

  assert.equal(plan.autoMatches.length, 1);
  assert.equal(plan.autoMatches[0].folder.name, "BONI POZO SANCHEZ");
  assert.deepEqual(plan.unmatchedFolders.map((folder) => folder.name), ["BONI POZO"]);
});

test("equally strong folder prefixes require manual review", () => {
  const plan = buildLegacyMatchPlan(
    [{ sourceRow: 10, fullName: "Boni Pozo Sánchez García" }],
    [{ name: "BONI POZO" }, { name: "BONI POZO SANCHEZ" }]
  );

  assert.equal(plan.autoMatches.length, 0);
  assert.equal(plan.ambiguous.length, 1);
});
