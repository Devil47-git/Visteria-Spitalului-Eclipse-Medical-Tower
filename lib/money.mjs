export function formatDollars(cents) {
  return `$${Math.round(Number(cents) / 100).toLocaleString("en-US")}`;
}

export function parseWholeDollars(value) {
  const normalized = String(value ?? "").trim().replaceAll(",", "");
  if (!/^\d{1,12}$/.test(normalized)) {
    throw new Error("Suma trebuie să fie un număr întreg pozitiv de dolari.");
  }
  const dollars = Number(normalized);
  if (!Number.isSafeInteger(dollars) || dollars <= 0) {
    throw new Error("Suma trebuie să fie un număr întreg pozitiv de dolari.");
  }
  return dollars * 100;
}
