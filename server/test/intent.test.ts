import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DATA_DIR = fileURLToPath(new URL("./.tmp-intent/", import.meta.url));
const { heuristicIntent } = await import("../src/engine/intent.ts");
const today = new Date("2026-11-25T06:00:00Z");

test("unsupported places are flagged, never substituted", () => {
  const a = heuristicIntent("मुझे नेपाल से अहमदाबाद तक जाना है 25 नवंबर को।", {}, today);
  assert.deepEqual(a.unknownPlaces, ["Ahmedabad", "Nepal"]);
  assert.equal(a.origin, undefined);
  assert.equal(a.destination, undefined);
  assert.deepEqual(heuristicIntent("Bangalore to Goa on 28 Dec", {}, today).unknownPlaces, ["Goa"]);
});

test("'gaya' (went) is not mistaken for a place", () => {
  assert.equal(heuristicIntent("main kal gaya tha, ab Gonda jaana hai", {}, today).unknownPlaces, undefined);
});

test("covered trips still parse", () => {
  const a = heuristicIntent("26 दिसंबर के आसपास बेंगलुरु से गोंडा जाना है, फ्लाइट ट्रेन कैब सब चलेगा", {}, today);
  assert.equal(a.origin, "BLR");
  assert.equal(a.destination, "GD");
  assert.equal(a.date, "2026-12-26");
  assert.deepEqual(a.modes, ["flight", "train", "cab"]);
  assert.equal(a.unknownPlaces, undefined);
  assert.deepEqual(a.mentioned, ["BLR", "GD"]);
});

test("25 Nov (today) is not pushed to next year", () => {
  assert.equal(heuristicIntent("25 नवंबर को लखनऊ", {}, today).date, "2026-11-25");
});
