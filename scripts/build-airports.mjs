#!/usr/bin/env node
// Build server/src/data/airports-in.json from OurAirports (public domain, https://ourairports.com/data/).
// Keeps Indian airports that have scheduled passenger service and an IATA code.
//   curl -o /tmp/airports.csv https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv
//   node scripts/build-airports.mjs /tmp/airports.csv
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/build-airports.mjs <airports.csv>");
  process.exit(1);
}

const STATES = {
  "IN-AN": "Andaman and Nicobar Islands", "IN-AP": "Andhra Pradesh", "IN-AR": "Arunachal Pradesh", "IN-AS": "Assam", "IN-BR": "Bihar",
  "IN-CH": "Chandigarh", "IN-CT": "Chhattisgarh", "IN-CG": "Chhattisgarh", "IN-DH": "Dadra and Nagar Haveli and Daman and Diu", "IN-DN": "Dadra and Nagar Haveli",
  "IN-DD": "Daman and Diu", "IN-DL": "Delhi", "IN-GA": "Goa", "IN-GJ": "Gujarat", "IN-HR": "Haryana", "IN-HP": "Himachal Pradesh",
  "IN-JK": "Jammu and Kashmir", "IN-JH": "Jharkhand", "IN-KA": "Karnataka", "IN-KL": "Kerala", "IN-LA": "Ladakh", "IN-LD": "Lakshadweep",
  "IN-MP": "Madhya Pradesh", "IN-MH": "Maharashtra", "IN-MM": "Maharashtra", "IN-MN": "Manipur", "IN-ML": "Meghalaya", "IN-MZ": "Mizoram", "IN-NL": "Nagaland",
  "IN-OR": "Odisha", "IN-OD": "Odisha", "IN-PY": "Puducherry", "IN-PB": "Punjab", "IN-RJ": "Rajasthan", "IN-SK": "Sikkim", "IN-TN": "Tamil Nadu",
  "IN-TG": "Telangana", "IN-TS": "Telangana", "IN-TR": "Tripura", "IN-UP": "Uttar Pradesh", "IN-UT": "Uttarakhand", "IN-UK": "Uttarakhand", "IN-WB": "West Bengal",
};

function parseLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; continue; }
    if (ch === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(src, "utf8").split(/\r?\n/).filter(Boolean);
const head = parseLine(lines[0]);
const col = (name) => head.indexOf(name);
const SIZE = { large_airport: "large", medium_airport: "medium", small_airport: "small" };

// Cities whose OurAirports "municipality" isn't the name people use.
const RENAME = { Bangalore: "Bengaluru", "New Delhi": "Delhi", Bombay: "Mumbai", Calcutta: "Kolkata", Madras: "Chennai", Trivandrum: "Thiruvananthapuram" };
// Per airport: the city it serves (OurAirports often has the airport's village) and other names people say.
const BY_IATA = {
  AYJ: ["Ayodhya", "faizabad"], DHM: ["Dharamshala", "kangra", "dharamsala"], DXN: ["Noida", "jewar"], GOI: ["Goa", "dabolim", "vasco da gama"],
  GOX: ["Goa", "mopa"], HGI: ["Itanagar", "hollongi"], IXI: ["Lakhimpur", "north lakhimpur", "lilabari"], IXD: ["Prayagraj", "allahabad"],
  JRG: ["Jharsuguda"], JSA: ["Jaisalmer"], KJB: ["Kurnool", "orvakal"], KUU: ["Kullu", "manali", "bhuntar"], MYQ: ["Mysuru", "mysore"],
  RJA: ["Rajahmundry", "rajamahendravaram"], SAG: ["Shirdi"], SDW: ["Sindhudurg", "chipi"], TCR: ["Thoothukudi", "tuticorin"],
  TEZ: ["Tezpur"], CCJ: ["Kozhikode", "calicut"], IXU: ["Aurangabad", "chhatrapati sambhajinagar"], IXG: ["Belagavi", "belgaum"],
  AIP: ["Jalandhar", "adampur"], HWR: ["Ludhiana", "halwara"], HBX: ["Hubballi", "hubli"], IXE: ["Mangaluru", "mangalore"],
  GBI: ["Kalaburagi", "gulbarga"], IXB: ["Siliguri", "bagdogra"], COK: ["Kochi", "cochin"], TRV: ["Thiruvananthapuram", "trivandrum"],
  SLV: ["Shimla", "jubbarhatti"], BDQ: ["Vadodara", "baroda"], CCU: ["Kolkata", "calcutta"], MAA: ["Chennai", "madras"], VTZ: ["Visakhapatnam", "vizag"],
};
// Airports with scheduled flights that OurAirports marks as having none (checked Nov 2026).
const FORCE_SCHEDULED = new Set(["SLV"]);
const FORCE_SIZE = { SLV: "small" };

const out = [];
for (const line of lines.slice(1)) {
  const r = parseLine(line);
  const iata = r[col("iata_code")];
  if (r[col("iso_country")] !== "IN" || (r[col("scheduled_service")] !== "yes" && !FORCE_SCHEDULED.has(iata))) continue;
  const size = FORCE_SIZE[iata] ?? SIZE[r[col("type")]];
  if (!/^[A-Z]{3}$/.test(iata) || !size) continue;
  let city = (r[col("municipality")] || r[col("name")]).split(/[,(]/)[0].replace(/\s+Airport$/i, "").trim();
  city = RENAME[city] ?? city;
  const [rename, ...aliases] = BY_IATA[iata] ?? [];
  out.push({
    iata, name: r[col("name")], city: rename ?? city, size, ...(aliases.length ? { aliases } : {}),
    lat: Math.round(Number(r[col("latitude_deg")]) * 1e4) / 1e4,
    lng: Math.round(Number(r[col("longitude_deg")]) * 1e4) / 1e4,
    state: STATES[r[col("iso_region")]],
  });
}
out.sort((a, b) => a.iata.localeCompare(b.iata));
const dest = new URL("../server/src/data/airports-in.json", import.meta.url);
mkdirSync(new URL(".", dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 0).replace(/},{/g, "},\n{") + "\n");
const bySize = out.reduce((a, x) => ((a[x.size] = (a[x.size] ?? 0) + 1), a), {});
console.log(`wrote ${out.length} airports`, bySize);
