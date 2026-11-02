export function sortAccessEntriesByCallsign(entries, roles = []) {
  return [...entries].sort((a, b) => {
    const roleRank = (role) => roles.find((item) => item.code === role)?.rank ?? (role === "membru" ? 999 : Number.parseInt(role, 10) || 999);
    return roleRank(a.role) - roleRank(b.role) || String(a.callsign || "").localeCompare(
      String(b.callsign || ""), "en", { numeric: true, sensitivity: "base" }
    );
  });
}

export function canDeleteAccessCode(code) {
  return Boolean(code.usedAt || !code.active);
}
