import { normalizeRole } from "./roles.mjs";

export function createAccessEntry(value) {
  const discordId = typeof value?.discordId === "string" ? value.discordId.trim() : "";
  const displayName = typeof value?.displayName === "string" ? value.displayName.trim() : "";
  const callsignInput = typeof value?.callsign === "string" ? value.callsign.trim() : "";
  const callsign = /^M-/i.test(callsignInput) ? `M-${callsignInput.slice(2).trim()}` : `M-${callsignInput}`;
  const role = normalizeRole(value?.role);
  const isHr = value?.isHr === true;
  if (!/^\d{17,20}$/.test(discordId)) {
    throw new Error("ID-ul Discord trebuie să conțină între 17 și 20 de cifre.");
  }
  if (!displayName || displayName.length > 80) {
    throw new Error("Numele trebuie să conțină între 1 și 80 de caractere.");
  }
  if (callsign === "M-" || callsign.length > 32 || !/^M-[A-Za-z0-9-]+$/.test(callsign)) {
    throw new Error("Completează un callsign valid după prefixul M-.");
  }
  return { discordId, displayName, callsign, role, isHr };
}

export function createAccessCodeRequest(value) {
  const discordId = typeof value?.discordId === "string" ? value.discordId.trim() : "";
  const displayName = typeof value?.displayName === "string" ? value.displayName.trim() : "";
  const callsignInput = typeof value?.callsign === "string" ? value.callsign.trim() : "";
  const callsign = /^M-/i.test(callsignInput) ? `M-${callsignInput.slice(2).trim()}` : `M-${callsignInput}`;
  const role = normalizeRole(value?.role);
  const isHr = value?.isHr === true;
  if (!/^\d{17,20}$/.test(discordId)) throw new Error("ID-ul Discord trebuie să conțină între 17 și 20 de cifre.");
  if (!displayName || displayName.length > 80) throw new Error("Numele trebuie să conțină între 1 și 80 de caractere.");
  if (callsign === "M-" || callsign.length > 32 || !/^M-[A-Za-z0-9-]+$/.test(callsign)) {
    throw new Error("Completează un callsign valid după prefixul M-.");
  }
  if (isHr && role !== "membru") throw new Error("Șef HR este o funcție separată de gradele medicale.");
  return { discordId, displayName, callsign, role, isHr };
}

export function createRedeemRequest(value) {
  const code = typeof value?.code === "string" ? value.code.trim().toUpperCase() : "";
  if (!code || code.length > 32) {
    throw new Error("Introdu codul de acces primit de la directori.");
  }
  return { code };
}

export function parseAmountToCents(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Introdu o sumă validă.");
  }

  const normalized = String(value).trim().replace(",", ".");
  if (!/^(?:\d{1,9})(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Suma trebuie să fie pozitivă și să aibă cel mult două zecimale.");
  }

  const [lei, bani = ""] = normalized.split(".");
  const cents = Number(lei) * 100 + Number(bani.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Suma trebuie să fie mai mare decât zero.");
  }

  return cents;
}
