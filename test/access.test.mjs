import test from "node:test";
import assert from "node:assert/strict";
import { createAccessEntry, createAccessCodeRequest, createRedeemRequest, parseAmountToCents } from "../lib/access.mjs";
import { isDirector, rankForRole, normalizeRole } from "../lib/roles.mjs";
import { formatDollars } from "../lib/money.mjs";

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
    callsign: "M-A-12",
    role: "004"
  }), {
    discordId: "12345678901234567",
    displayName: "Alex",
    callsign: "M-A-12",
    role: "004",
    isHr: false
  });
  assert.throws(() => createAccessEntry({ discordId: "abc", displayName: "Alex", callsign: "A-12" }));
  assert.throws(() => createAccessEntry({ discordId: "12345678901234567", displayName: "", callsign: "A-12" }));
  assert.throws(() => createAccessEntry({ discordId: "12345678901234567", displayName: "Alex", callsign: "" }));
  assert.equal(createAccessEntry({ discordId: "12345678901234567", displayName: "Alex", callsign: "A-12", role: "hacker" }).role, "membru");
});

test("code request validation", () => {
  assert.equal(createAccessCodeRequest({ discordId: "12345678901234567", displayName: "Dan", callsign: "D-01", role: "002" }).role, "002");
  assert.equal(createAccessCodeRequest({ discordId: "12345678901234567", displayName: "Dan", callsign: "D-01", role: "002" }).callsign, "M-D-01");
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
