export function formatDollars(cents) {
  return `$${Math.round(Number(cents) / 100).toLocaleString("en-US")}`;
}

export function parseWholeDollars(value) {
  const raw = String(value ?? "").trim();
  if (/^\d{1,3}(,\d{3})+$/.test(raw)) {
    const normalized = raw.replaceAll(",", "");
    const dollars = Number(normalized);
    if (Number.isSafeInteger(dollars) && dollars > 0) return dollars * 100;
  }
  const normalized = raw;
  if (!/^\d{1,12}$/.test(normalized)) {
    throw new Error("Suma trebuie să fie un număr întreg pozitiv de dolari.");
  }
  const dollars = Number(normalized);
  if (!Number.isSafeInteger(dollars) || dollars <= 0) {
    throw new Error("Suma trebuie să fie un număr întreg pozitiv de dolari.");
  }
  return dollars * 100;
}
