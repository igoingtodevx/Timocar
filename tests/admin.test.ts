import test from "node:test";
import assert from "node:assert/strict";
import {
  canStartCheckout,
  isAllowedAdminEmail,
  normalizeAdminOrderUpdate,
  normalizeStorefrontSettings,
  resolveAdminRole,
  type StorefrontSettings,
} from "../shared/admin.js";

test("storefront settings default to accepting new orders and can be paused", () => {
  const defaultSettings = normalizeStorefrontSettings({});
  if ("error" in defaultSettings) throw new Error(defaultSettings.error);
  assert.deepEqual(defaultSettings, { acceptingOrders: true });
  assert.equal(canStartCheckout(defaultSettings), true);

  const paused = normalizeStorefrontSettings({ acceptingOrders: false });
  if ("error" in paused) throw new Error(paused.error);
  assert.deepEqual(paused, { acceptingOrders: false });
  assert.equal(canStartCheckout(paused), false);
});

test("only configured admin email addresses may request an operator login", () => {
  assert.equal(isAllowedAdminEmail("owner@autowunsch.example", "owner@autowunsch.example, team@autowunsch.example"), true);
  assert.equal(isAllowedAdminEmail("TEAM@AUTOWUNSCH.EXAMPLE", "owner@autowunsch.example, team@autowunsch.example"), true);
  assert.equal(isAllowedAdminEmail("visitor@autowunsch.example", "owner@autowunsch.example, team@autowunsch.example"), false);
  assert.equal(isAllowedAdminEmail("not-an-email", "owner@autowunsch.example"), false);
  assert.equal(resolveAdminRole("owner@autowunsch.example", "owner@autowunsch.example", "team@autowunsch.example"), "owner");
  assert.equal(resolveAdminRole("team@autowunsch.example", "owner@autowunsch.example", "team@autowunsch.example"), "staff");
  assert.equal(resolveAdminRole("visitor@autowunsch.example", "owner@autowunsch.example", "team@autowunsch.example"), null);
});

test("admin order updates only allow operational statuses and bounded internal notes", () => {
  assert.deepEqual(normalizeAdminOrderUpdate({ status: "in_progress", internalNote: "  Recherche gestartet.  " }), {
    status: "in_progress",
    internalNote: "Recherche gestartet.",
  });

  const invalidStatus = normalizeAdminOrderUpdate({ status: "refunded" });
  if (!("error" in invalidStatus)) throw new Error("Expected rejected status");
  assert.equal(invalidStatus.error, "Ungültiger Bestellstatus.");
  const tooLongNote = normalizeAdminOrderUpdate({ status: "completed", internalNote: "x".repeat(2001) });
  if (!("error" in tooLongNote)) throw new Error("Expected rejected internal note");
  assert.equal(tooLongNote.error, "Interne Notiz ist zu lang.");
});

test("settings input rejects non-boolean values instead of silently changing checkout availability", () => {
  const current: StorefrontSettings = { acceptingOrders: true };
  const invalidSettings = normalizeStorefrontSettings({ acceptingOrders: "false" }, current);
  if (!("error" in invalidSettings)) throw new Error("Expected rejected settings input");
  assert.equal(invalidSettings.error, "Ungültige Shop-Einstellung.");
  const updatedSettings = normalizeStorefrontSettings({ acceptingOrders: false }, current);
  if ("error" in updatedSettings) throw new Error(updatedSettings.error);
  assert.deepEqual(updatedSettings, { acceptingOrders: false });
});
