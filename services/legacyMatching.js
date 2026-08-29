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

function namesAreCompatible(left, right) {
  return left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `);
}

function compatibleRows(groups, folderKey) {
  const matches = [];
  for (const [candidateKey, rows] of groups) {
    if (namesAreCompatible(candidateKey, folderKey)) matches.push(...rows);
  }
  return matches;
}

function buildLegacyMatchPlan(rows, folders) {
  const rowGroups = groupByNormalizedName(rows, (row) => row.fullName);
  const folderHintGroups = groupByNormalizedName(rows, (row) => row.folderHint);
  const folderGroups = groupByNormalizedName(folders, (folder) => folder.name);
  const autoMatches = [];
  const proposedMatches = [];
  const ambiguous = [];
  const matchedRows = new Set();
  const unmatchedFolders = [];

  for (const [folderKey, candidateFolders] of folderGroups) {
    const exactHintRows = folderHintGroups.get(folderKey) || [];
    const compatibleHintRows = exactHintRows.length ? [] : compatibleRows(folderHintGroups, folderKey);
    const exactNameRows = exactHintRows.length || compatibleHintRows.length ? [] : rowGroups.get(folderKey) || [];
    const compatibleNameRows = exactHintRows.length || compatibleHintRows.length || exactNameRows.length
      ? []
      : compatibleRows(rowGroups, folderKey);
    const candidateRows = exactHintRows.length
      ? exactHintRows
      : compatibleHintRows.length
        ? compatibleHintRows
        : exactNameRows.length
          ? exactNameRows
          : compatibleNameRows;
    const matchInfo = exactHintRows.length
      ? { strategy: "folder-column", priority: 4 }
      : compatibleHintRows.length
        ? { strategy: "folder-column", priority: 3 }
        : exactNameRows.length
          ? { strategy: "name", priority: 2 }
          : { strategy: "name", priority: 1 };

    if (candidateRows.length === 1 && candidateFolders.length === 1) {
      proposedMatches.push({ key: folderKey, row: candidateRows[0], folder: candidateFolders[0], ...matchInfo });
    } else if (candidateRows.length === 0) {
      unmatchedFolders.push(...candidateFolders);
    } else {
      ambiguous.push({ key: folderKey, rows: candidateRows, folders: candidateFolders });
    }
  }

  const proposalsByRow = new Map();
  for (const proposal of proposedMatches) {
    const rowKey = proposal.row.sourceRow;
    proposalsByRow.set(rowKey, [...(proposalsByRow.get(rowKey) || []), proposal]);
  }
  for (const proposals of proposalsByRow.values()) {
    const highestPriority = Math.max(...proposals.map((proposal) => proposal.priority));
    const preferred = proposals.filter((proposal) => proposal.priority === highestPriority);
    if (preferred.length === 1) {
      const [{ priority, ...match }] = preferred;
      autoMatches.push(match);
      matchedRows.add(match.row);
      unmatchedFolders.push(...proposals.filter((proposal) => proposal !== preferred[0]).map((proposal) => proposal.folder));
    } else {
      ambiguous.push({
        key: preferred.map((proposal) => proposal.key).join(" | "),
        rows: [preferred[0].row],
        folders: proposals.map((proposal) => proposal.folder),
      });
    }
  }

  const unmatchedRows = rows.filter((row) => !matchedRows.has(row));

  return { autoMatches, ambiguous, unmatchedRows, unmatchedFolders };
}

module.exports = { buildLegacyMatchPlan, groupByNormalizedName, namesAreCompatible, normalizedLegacyName };
