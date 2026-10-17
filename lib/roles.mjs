// Ierarhia de roluri din spital. Cu cât numărul e mai mic, cu atât rangul e mai mare.
export const ROLE_RANK = {
  "001": 1,
  "002": 2,
  "003": 3,
  "004": 4,
  "005": 5,
  "006": 6,
  "007": 7,
  "008": 8,
  "009": 9,
  "010": 10,
  "011": 11,
  "012": 12,
  "membru": 99
};

export const ROLE_LABELS = {
  "001": "001 — Director General",
  "002": "002 — Director adjunct",
  "003": "003 — Director adjunct",
  "004": "004 — Director adjunct",
  "005": "005 — Medic Inspector",
  "006": "006 — Medic Inspector",
  "007": "007 — Medic Inspector",
  "008": "008 — Medic Inspector",
  "009": "009 — Medic Chirurg",
  "010": "010 — Medic Chirurg",
  "011": "011 — Medic Chirurg",
  "012": "012 — Medic Chirurg",
  membru: "Membru"
};

export const ROLE_OPTIONS = Object.keys(ROLE_RANK);

// Directorii adjuncti și tot ce e peste (004, 003, 002, 001) + 007 (șef HR)
const DIRECTOR_MIN_RANK = 4;

export function rankForRole(role) {
  return ROLE_RANK[role] ?? ROLE_RANK.membru;
}

// Directori adjuncti+ (001-004); funcția Șef HR se verifică separat.
export function isDirector(role) {
  return rankForRole(role) <= DIRECTOR_MIN_RANK;
}

function normalizeRole(role) {
  const value = String(role || "").trim();
  if (value === "member") return "membru";
  return ROLE_RANK[value] !== undefined ? value : "membru";
}

export { normalizeRole };
