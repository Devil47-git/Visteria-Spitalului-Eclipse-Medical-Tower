// Ierarhia de roluri din spital. Cu cât numărul e mai mic, cu atât rangul e mai mare.
export const ROLE_RANK = {
  "007": 7, // Șef HR (fondator) — acces complet
  "001": 1,
  "002": 2,
  "003": 3,
  "004": 4, // directori adjuncti+
  "005": 5,
  "006": 6,
  "membru": 99
};

// Directorii adjuncti și tot ce e peste (004, 003, 002, 001) + 007 (șef HR)
const DIRECTOR_MIN_RANK = 4;

export function rankForRole(role) {
  return ROLE_RANK[role] ?? ROLE_RANK.membru;
}

// Directori adjuncti+ (001-004) și șeful HR (007)
export function isDirector(role) {
  const roleKey = role === "007" ? "007" : role;
  return roleKey === "007" || rankForRole(roleKey) <= DIRECTOR_MIN_RANK;
}

export function normalizeRole(role) {
  const value = String(role || "").trim();
  if (/^00[1-7]$/.test(value)) return value;
  return "membru";
}
