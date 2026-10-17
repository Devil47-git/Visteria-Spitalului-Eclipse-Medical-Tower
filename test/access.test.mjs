import test from "node:test";
import assert from "node:assert/strict";
import { createAccessEntry, createAccessCodeRequest, createRedeemRequest, parseAmountToCents } from "../lib/access.mjs";
import { isDirector, rankForRole, normalizeRole } from "../lib/roles.mjs";
import { formatDollars } from "../lib/money.mjs";
import { accessForOAuth, accessForPendingSession } from "../lib/access-policy.mjs";

test("active invite codes take precedence over old whitelist rows; bootstrap is explicit", () => {
  assert.equal(accessForOAuth({ isAdmin: false, isWhitelisted: true, hasActiveCode: true, bootstrapAllowed: false }), "pending");
  assert.equal(accessForOAuth({ isAdmin: true, isWhitelisted: true, hasActiveCode: true, bootstrapAllowed: false }), "pending");
  assert.equal(accessForOAuth({ isAdmin: true, isWhitelisted: false, hasActiveCode: true, bootstrapAllowed: false }), "pending");
  assert.equal(accessForOAuth({ isAdmin: true, isWhitelisted: false, hasActiveCode: false, bootstrapAllowed: false }), "authorized");
  assert.equal(accessForOAuth({ isAdmin: false, isWhitelisted: false, hasActiveCode: false, bootstrapAllowed: false }), "denied");
  assert.equal(accessForOAuth({ isAdmin: true, isWhitelisted: false, hasActiveCode: false, bootstrapAllowed: false }), "authorized");
  assert.equal(accessForOAuth({ isAdmin: false, isWhitelisted: false, hasActiveCode: false, bootstrapAllowed: true }), "bootstrap");
  assert.equal(accessForPendingSession({ isAdmin: false, isWhitelisted: true, hasActiveCode: true }), "pending");
  assert.equal(accessForPendingSession({ isAdmin: true, isWhitelisted: false, hasActiveCode: true }), "pending");
});

test("formats integer dollar display without decimals", () => {
  assert.equal(formatDollars(10000000), "$100,000");
  assert.equal(formatDollars(1550000), "$15,500");
});

test("converts Romanian decimal input into integer cents", () => {
  assert.equal(parseAmountToCents("125"), 12500);
  assert.equal(parseAmountToCents("12,3"), 1230);
  assert.equal(parseAmountToCents("0.01"), 1);
});

test("rejects zero, negative, malformed, and over-precise amounts", () => {
  for (const amount of ["0", "-1", "1e3", "abc", "1000000000"]) {
    assert.throws(() => parseAmountToCents(amount));
  }
});

test("access members require a Discord ID, name, callsign, and valid role", () => {
  assert.deepEqual(createAccessEntry({
    discordId: "12345678901234567",
    displayName: "Alex",
    callsign: "M-012",
    role: "004"
  }), {
    discordId: "12345678901234567",
    displayName: "Alex",
    callsign: "M-012",
    role: "004",
    isHr: false
  });
  assert.throws(() => createAccessEntry({ discordId: "abc", displayName: "Alex", callsign: "A-12" }));
  assert.throws(() => createAccessEntry({ discordId: "12345678901234567", displayName: "", callsign: "A-12" }));
  assert.throws(() => createAccessEntry({ discordId: "12345678901234567", displayName: "Alex", callsign: "" }));
  assert.throws(() => createAccessEntry({ discordId: "12345678901234567", displayName: "Alex", callsign: "1", role: "membru" }));
  assert.throws(() => createAccessEntry({ discordId: "12345678901234567", displayName: "Alex", callsign: "0001", role: "membru" }));
  assert.deepEqual(createAccessEntry({ discordId: "12345678901234567", displayName: "Alex", callsign: "000", role: "membru" }).callsign, "M-000");
  assert.equal(createAccessEntry({ discordId: "12345678901234567", displayName: "Alex", callsign: "M-012", role: "hacker" }).role, "membru");
});

test("code request validation", () => {
  assert.equal(createAccessCodeRequest({ discordId: "12345678901234567", displayName: "Dan", callsign: "007", role: "002" }).role, "002");
  assert.equal(createAccessCodeRequest({ discordId: "12345678901234567", displayName: "Dan", callsign: "007", role: "002" }).callsign, "M-007");
  assert.throws(() => createAccessCodeRequest({ discordId: "12345678901234567", displayName: "Dan", callsign: "01", role: "002" }));
  assert.throws(() => createAccessCodeRequest({ discordId: "12", displayName: "Dan", callsign: "D-01" }));
});

test("redeem request validation", () => {
  assert.deepEqual(createRedeemRequest({ code: " vist-abcd-1234 " }), { code: "VIST-ABCD-1234" });
  assert.throws(() => createRedeemRequest({ code: "" }));
});

test("role hierarchy: directors are 001-004, medical tiers are not directors", () => {
  for (const role of ["001", "002", "003", "004"]) assert.ok(isDirector(role), `${role} ar trebui să fie director`);
  assert.ok(!isDirector("007"));
  assert.ok(!isDirector("005"));
  assert.ok(!isDirector("006"));
  assert.ok(!isDirector("008"));
  assert.ok(!isDirector("009"));
  assert.ok(!isDirector("membru"));
  assert.equal(rankForRole("001"), 1);
  assert.equal(rankForRole("007"), 7);
  assert.equal(rankForRole("012"), 12);
  assert.equal(rankForRole("membru"), 99);
  assert.equal(normalizeRole("004x"), "membru");
  assert.equal(normalizeRole("003"), "003");
});


test("admin access entries sort by callsign numerically", async () => {
  const { sortAccessEntriesByCallsign } = await import("../public/admin-utils.mjs");
  const entries = [
    { callsign: "M-100" },
    { callsign: "M-012" },
    { callsign: "M-002" },
    { callsign: "M-020" }
  ];
  assert.deepEqual(sortAccessEntriesByCallsign(entries).map((entry) => entry.callsign), [
    "M-002", "M-012", "M-020", "M-100"
  ]);
  assert.equal(entries[0].callsign, "M-100", "sorting must not mutate the source list");
});

test("only used or deactivated access codes can be deleted from the admin list", async () => {
  const { canDeleteAccessCode } = await import("../public/admin-utils.mjs");
  assert.equal(canDeleteAccessCode({ active: true, usedAt: null }), false);
  assert.equal(canDeleteAccessCode({ active: false, usedAt: null }), true);
  assert.equal(canDeleteAccessCode({ active: true, usedAt: "2026-01-01T00:00:00.000Z" }), true);
});
