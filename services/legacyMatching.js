function normalizedLegacyName(value) {
  return String(value || "")
    .replace(/„/g, "Ñ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function groupByNormalizedName(items, getName) {
  const groups = new Map();
  for (const item of items) {
    const key = normalizedLegacyName(getName(item));
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return groups;
}

function buildLegacyMatchPlan(rows, folders) {
  const rowGroups = groupByNormalizedName(rows, (row) => row.fullName);
  const folderGroups = groupByNormalizedName(folders, (folder) => folder.name);
  const autoMatches = [];
  const ambiguous = [];
  const matchedRows = new Set();
  const unmatchedFolders = [];

  for (const [folderKey, candidateFolders] of folderGroups) {
    const candidateRows = [];
    for (const [rowKey, matchingRows] of rowGroups) {
      if (rowKey === folderKey || rowKey.startsWith(`${folderKey} `) || folderKey.startsWith(`${rowKey} `)) {
        candidateRows.push(...matchingRows);
      }
    }

    if (candidateRows.length === 1 && candidateFolders.length === 1) {
      autoMatches.push({ key: folderKey, row: candidateRows[0], folder: candidateFolders[0] });
      matchedRows.add(candidateRows[0]);
    } else if (candidateRows.length === 0) {
      unmatchedFolders.push(...candidateFolders);
    } else {
      ambiguous.push({ key: folderKey, rows: candidateRows, folders: candidateFolders });
    }
  }

  const unmatchedRows = rows.filter((row) => !matchedRows.has(row));

  return { autoMatches, ambiguous, unmatchedRows, unmatchedFolders };
}

module.exports = { buildLegacyMatchPlan, groupByNormalizedName, normalizedLegacyName };
