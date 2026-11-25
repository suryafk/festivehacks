import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DATA_DIR = fileURLToPath(new URL("./.tmp-intent/", import.meta.url));
const { heuristicIntent } = await import("../src/engine/intent.ts");
const today = new Date("2026-11-25T06:00:00Z");

test("places outside India are flagged, never substituted", () => {
  const a = heuristicIntent("मुझे नेपाल से अहमदाबाद तक जाना है 25 नवंबर को।", {}, today);
  assert.deepEqual(a.unknownPlaces, ["Nepal"]);
  assert.equal(a.origin, undefined); // Nepal is never replaced by an Indian city
  assert.equal(a.destinationName, "अहमदाबाद"); // passed on to be looked up
});

test("any Indian city works: airports are spotted, other names are passed on for lookup", () => {
  const goa = heuristicIntent("Bangalore to Goa on 28 Dec", {}, today);
  assert.equal(goa.origin, "BLR");
  assert.ok(["GOI", "GOX"].includes(goa.destination ?? ""));
  assert.equal(goa.unknownPlaces, undefined);
  const r = heuristicIntent("from Pune to Rishikesh on 2 Jan", {}, today);
  assert.equal(r.origin, "PNQ");
  assert.equal(r.destinationName, "Rishikesh");
  const m = heuristicIntent("Hyderabad to Madhubani around 3 jan", {}, today);
  assert.equal(m.origin, "HYD"); // the sentence's shape decides, not "big city = origin"
  assert.equal(m.destinationName, "Madhubani");
});

test("'gaya' (went) is not mistaken for a place", () => {
  const a = heuristicIntent("main kal gaya tha, ab Gonda jaana hai", {}, today);
  assert.equal(a.unknownPlaces, undefined);
  assert.equal(a.origin, undefined);
  assert.equal(a.destination, "GD");
  assert.equal(heuristicIntent("Patna se Gaya 28 Dec", {}, today).destination, "GAY"); // but it is a place here
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
