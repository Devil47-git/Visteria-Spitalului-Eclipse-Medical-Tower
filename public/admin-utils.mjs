export function sortAccessEntriesByCallsign(entries) {
  return [...entries].sort((a, b) => String(a.callsign || "").localeCompare(
    String(b.callsign || ""), "en", { numeric: true, sensitivity: "base" }
 ));
}

export function canDeleteAccessCode(code) {
  return Boolean(code.usedAt || !code.active);
}
