// Simulated travel network. Timings and fares are realistic-looking but NOT live data.

export type Mode = "flight" | "train" | "cab";

export interface City {
  code: string;
  name: string;
  aliases: string[];
  kind: "metro" | "hub" | "town";
  hub?: string; // for towns: nearest airport hub
  kmFromHub?: number; // road distance from the hub airport
  altHub?: string; // second-choice airport (bigger / better connected), tried when the first has no flights
  lat: number;
  lng: number;
  state?: string;
  /** Where this place came from: hand-made seed, the OurAirports list, or an OpenStreetMap lookup. */
  source?: "seed" | "airport" | "geocoded";
  airportSize?: "large" | "medium" | "small";
}

export interface TrainLeg {
  name: string;
  from: string; // city code
  to: string;
  dep: string; // HH:MM local
  durMin: number;
  fare: number; // 3A fare
  days?: number[]; // 0=Sun..6; undefined = daily
}

export interface FlightRoute {
  from: string;
  to: string;
  deps: string[];
  durMin: number;
  baseFare: number;
  airline: string[];
}

export const cities: City[] = [
  { code: "BLR", name: "Bengaluru", aliases: ["bangalore", "bengaluru", "blr", "बेंगलुरु", "बैंगलोर", "बंगलौर"], kind: "metro", lat: 12.97, lng: 77.59 },
  { code: "DEL", name: "Delhi", aliases: ["delhi", "new delhi", "dilli", "दिल्ली"], kind: "metro", lat: 28.61, lng: 77.21 },
  { code: "BOM", name: "Mumbai", aliases: ["mumbai", "bombay", "मुंबई"], kind: "metro", lat: 19.08, lng: 72.88 },
  { code: "HYD", name: "Hyderabad", aliases: ["hyderabad", "हैदराबाद"], kind: "metro", lat: 17.39, lng: 78.49 },

  { code: "LKO", name: "Lucknow", aliases: ["lucknow", "lko", "लखनऊ", "लखनउ"], kind: "hub", lat: 26.85, lng: 80.95 },
  { code: "PAT", name: "Patna", aliases: ["patna", "पटना"], kind: "hub", lat: 25.59, lng: 85.14 },
  { code: "VNS", name: "Varanasi", aliases: ["varanasi", "banaras", "benaras", "kashi", "वाराणसी", "बनारस"], kind: "hub", lat: 25.32, lng: 82.97 },

  { code: "GKP", name: "Gorakhpur", aliases: ["gorakhpur", "गोरखपुर"], kind: "town", hub: "LKO", kmFromHub: 275, lat: 26.76, lng: 83.37 },
  { code: "GD", name: "Gonda", aliases: ["gonda", "गोंडा"], kind: "town", hub: "LKO", kmFromHub: 125, lat: 27.13, lng: 81.96 },
  { code: "BST", name: "Basti", aliases: ["basti", "बस्ती"], kind: "town", hub: "LKO", kmFromHub: 205, lat: 26.8, lng: 82.73 },
  { code: "AY", name: "Ayodhya", aliases: ["ayodhya", "faizabad", "अयोध्या", "फैजाबाद"], kind: "town", hub: "LKO", kmFromHub: 135, lat: 26.79, lng: 82.2 },
  { code: "BRK", name: "Barabanki", aliases: ["barabanki", "बाराबंकी"], kind: "town", hub: "LKO", kmFromHub: 40, lat: 26.93, lng: 81.19 },
  { code: "SLN", name: "Sultanpur", aliases: ["sultanpur", "सुल्तानपुर"], kind: "town", hub: "LKO", kmFromHub: 140, lat: 26.26, lng: 82.07 },

  { code: "ARA", name: "Ara", aliases: ["ara", "arrah", "आरा"], kind: "town", hub: "PAT", kmFromHub: 60, lat: 25.56, lng: 84.66 },
  { code: "HJP", name: "Hajipur", aliases: ["hajipur", "हाजीपुर"], kind: "town", hub: "PAT", kmFromHub: 25, lat: 25.69, lng: 85.21 },
  { code: "BGS", name: "Begusarai", aliases: ["begusarai", "बेगूसराय"], kind: "town", hub: "PAT", kmFromHub: 125, lat: 25.42, lng: 86.13 },
  { code: "CPR", name: "Chhapra", aliases: ["chhapra", "chapra", "छपरा"], kind: "town", hub: "PAT", kmFromHub: 75, lat: 25.78, lng: 84.73 },

  { code: "JNU", name: "Jaunpur", aliases: ["jaunpur", "जौनपुर"], kind: "town", hub: "VNS", kmFromHub: 70, lat: 25.75, lng: 82.69 },
  { code: "GZP", name: "Ghazipur", aliases: ["ghazipur", "गाज़ीपुर", "गाजीपुर"], kind: "town", hub: "VNS", kmFromHub: 80, lat: 25.58, lng: 83.58 },
  { code: "MZP", name: "Mirzapur", aliases: ["mirzapur", "मिर्ज़ापुर", "मिर्जापुर"], kind: "town", hub: "VNS", kmFromHub: 75, lat: 25.15, lng: 82.57 },

  // towns with seeded long-distance trains (no airport of their own)
  { code: "JHS", name: "Jhansi", aliases: ["jhansi", "झाँसी", "झांसी"], kind: "town", hub: "GWL", kmFromHub: 105, lat: 25.45, lng: 78.57 },
  { code: "TATA", name: "Jamshedpur", aliases: ["jamshedpur", "tatanagar", "जमशेदपुर", "टाटानगर"], kind: "town", hub: "IXR", kmFromHub: 130, lat: 22.8, lng: 86.2 },
];

for (const c of cities) c.source = "seed";

/**
 * Every place the app knows, by code: the seed above, plus airports (IATA codes) and places looked up at
 * runtime (codes like "x-shimla"), which `places.ts` adds with `registerPlace`. Watcher pods get the places
 * they need with each job, so they never need the database.
 */
export const cityByCode = new Map<string, City>(cities.map((c) => [c.code, c]));
export function registerPlace(c: City) {
  const prev = cityByCode.get(c.code);
  if (prev?.source === "seed") return prev; // hand-made data wins (it has trains, Hindi names, seed riders)
  cityByCode.set(c.code, c);
  return c;
}

const origins = ["BLR", "DEL", "BOM", "HYD"];
const hubBase: Record<string, { dur: Record<string, number>; fare: Record<string, number> }> = {
  LKO: { dur: { BLR: 165, DEL: 70, BOM: 120, HYD: 125 }, fare: { BLR: 5200, DEL: 3100, BOM: 4600, HYD: 4300 } },
  PAT: { dur: { BLR: 170, DEL: 95, BOM: 150, HYD: 140 }, fare: { BLR: 5600, DEL: 3600, BOM: 5100, HYD: 4700 } },
  VNS: { dur: { BLR: 150, DEL: 85, BOM: 135, HYD: 130 }, fare: { BLR: 5400, DEL: 3400, BOM: 4900, HYD: 4500 } },
};
const deps = ["05:40", "07:15", "09:30", "12:05", "14:50", "17:35", "20:10"];

export const flights: FlightRoute[] = origins.flatMap((o) =>
  Object.entries(hubBase).map(([hub, b]) => ({
    from: o,
    to: hub,
    deps: deps.filter((_, i) => (i + o.charCodeAt(0) + hub.charCodeAt(0)) % 7 !== 0),
    durMin: b.dur[o],
    baseFare: b.fare[o],
    airline: ["IndiGo", "Air India Express", "Akasa Air"],
  })),
);

// hub station -> town trains (several per day), plus a few long-distance direct trains from metros
export const trains: TrainLeg[] = [
  // Lucknow (Charbagh) ->
  { name: "Lucknow–Gorakhpur Intercity", from: "LKO", to: "GKP", dep: "06:10", durMin: 300, fare: 545 },
  { name: "Avadh Express", from: "LKO", to: "GKP", dep: "15:40", durMin: 320, fare: 560 },
  { name: "Gomti Link Express", from: "LKO", to: "GKP", dep: "19:25", durMin: 310, fare: 545 },
  { name: "Lucknow–Gonda MEMU", from: "LKO", to: "GD", dep: "07:00", durMin: 150, fare: 120 },
  { name: "Saryu Intercity", from: "LKO", to: "GD", dep: "16:45", durMin: 135, fare: 305 },
  { name: "Lucknow–Basti Express", from: "LKO", to: "BST", dep: "13:20", durMin: 235, fare: 430 },
  { name: "Saket Express", from: "LKO", to: "BST", dep: "18:05", durMin: 245, fare: 445 },
  { name: "Ayodhya Vande Bharat", from: "LKO", to: "AY", dep: "16:10", durMin: 120, fare: 690 },
  { name: "Lucknow–Ayodhya Passenger", from: "LKO", to: "AY", dep: "10:30", durMin: 175, fare: 95 },
  { name: "Lucknow–Sultanpur Express", from: "LKO", to: "SLN", dep: "17:20", durMin: 170, fare: 315 },
  // Patna ->
  { name: "Patna–Ara Fast Passenger", from: "PAT", to: "ARA", dep: "15:30", durMin: 75, fare: 60 },
  { name: "Sampoorna Kranti Link", from: "PAT", to: "ARA", dep: "19:10", durMin: 60, fare: 235 },
  { name: "Patna–Chhapra Intercity", from: "PAT", to: "CPR", dep: "17:45", durMin: 110, fare: 210 },
  { name: "Patna–Begusarai MEMU", from: "PAT", to: "BGS", dep: "16:20", durMin: 170, fare: 85 },
  // Varanasi ->
  { name: "Varanasi–Jaunpur Express", from: "VNS", to: "JNU", dep: "15:15", durMin: 85, fare: 190 },
  { name: "Varanasi–Ghazipur Passenger", from: "VNS", to: "GZP", dep: "16:40", durMin: 120, fare: 70 },
  { name: "Vindhyachal Intercity", from: "VNS", to: "MZP", dep: "18:00", durMin: 95, fare: 180 },
  // long-distance direct (for train-only travellers)
  { name: "Yesvantpur–Gorakhpur Express", from: "BLR", to: "GKP", dep: "07:20", durMin: 2580, fare: 2890, days: [0, 3] },
  { name: "Sanghamitra Express", from: "BLR", to: "PAT", dep: "09:00", durMin: 2700, fare: 2960 },
  { name: "Bengaluru–Lucknow Express", from: "BLR", to: "LKO", dep: "13:25", durMin: 2460, fare: 2780, days: [1, 4] },
  { name: "Delhi–Gorakhpur Humsafar", from: "DEL", to: "GKP", dep: "17:00", durMin: 780, fare: 1680 },
  { name: "Delhi–Lucknow Shatabdi", from: "DEL", to: "LKO", dep: "06:10", durMin: 390, fare: 1450 },

  // Bengaluru ⇄ Mumbai
  { name: "Udyan Express", from: "BLR", to: "BOM", dep: "20:00", durMin: 1555, fare: 1560 },
  { name: "Bengaluru–LTT Superfast", from: "BLR", to: "BOM", dep: "15:30", durMin: 1440, fare: 1620, days: [2, 5] },
  { name: "Udyan Express", from: "BOM", to: "BLR", dep: "08:05", durMin: 1495, fare: 1560 },
  { name: "LTT–Bengaluru Superfast", from: "BOM", to: "BLR", dep: "22:30", durMin: 1440, fare: 1620, days: [3, 6] },
  // Bengaluru ⇄ Pune
  { name: "Udyan Express", from: "BLR", to: "PNQ", dep: "20:00", durMin: 1200, fare: 1340 },
  { name: "Coimbatore–LTT Express", from: "BLR", to: "PNQ", dep: "12:10", durMin: 1150, fare: 1380, days: [1, 4] },
  { name: "Udyan Express", from: "PNQ", to: "BLR", dep: "11:25", durMin: 1180, fare: 1340 },
  { name: "Pune–Bengaluru Superfast", from: "PNQ", to: "BLR", dep: "18:45", durMin: 1150, fare: 1380, days: [3, 6] },
  // Pune ⇄ Mumbai
  { name: "Deccan Queen", from: "PNQ", to: "BOM", dep: "07:15", durMin: 195, fare: 455 },
  { name: "Sinhagad Express", from: "PNQ", to: "BOM", dep: "06:05", durMin: 220, fare: 390 },
  { name: "Pragati Express", from: "PNQ", to: "BOM", dep: "15:15", durMin: 210, fare: 420 },
  { name: "Deccan Queen", from: "BOM", to: "PNQ", dep: "17:10", durMin: 195, fare: 455 },
  { name: "Intercity Express", from: "BOM", to: "PNQ", dep: "06:40", durMin: 200, fare: 420 },
  { name: "Pragati Express", from: "BOM", to: "PNQ", dep: "16:25", durMin: 210, fare: 420 },
  // Hyderabad ⇄ Jhansi
  { name: "Telangana Express", from: "HYD", to: "JHS", dep: "06:00", durMin: 1125, fare: 1650 },
  { name: "Dakshin Express", from: "HYD", to: "JHS", dep: "23:00", durMin: 1240, fare: 1580 },
  { name: "Telangana Express", from: "JHS", to: "HYD", dep: "09:40", durMin: 1140, fare: 1650 },
  { name: "Dakshin Express", from: "JHS", to: "HYD", dep: "17:30", durMin: 1250, fare: 1580 },
  // Jamshedpur (Tatanagar) ⇄ Mumbai
  { name: "Gitanjali Express", from: "TATA", to: "BOM", dep: "16:20", durMin: 1680, fare: 1990 },
  { name: "Tata–LTT Express", from: "TATA", to: "BOM", dep: "07:45", durMin: 1620, fare: 1940, days: [0, 3] },
  { name: "Gitanjali Express", from: "BOM", to: "TATA", dep: "06:00", durMin: 1680, fare: 1990 },
  { name: "LTT–Tata Express", from: "BOM", to: "TATA", dep: "21:10", durMin: 1620, fare: 1940, days: [2, 5] },
];

export const AIRPORT_TO_STATION_MIN: Record<string, number> = { LKO: 40, PAT: 30, VNS: 45 };

export const cab = {
  baseFare: 300,
  perKm: 14, // sedan, festive-season outstation rate
  kmh: 48, // avg speed on UP/Bihar highways incl. stops
};

// Simulated co-travellers already registered (so pooling has something to match on day one).
export const seedRiders = [
  { name: "Ankit", hub: "LKO", to: "GKP", arriveOffsetMin: 15, dropKm: 275 },
  { name: "Pooja", hub: "LKO", to: "BST", arriveOffsetMin: -35, dropKm: 205 },
  { name: "Imran", hub: "LKO", to: "GD", arriveOffsetMin: 40, dropKm: 125 },
  { name: "Shalini", hub: "LKO", to: "AY", arriveOffsetMin: -10, dropKm: 135 },
  { name: "Manoj", hub: "LKO", to: "BRK", arriveOffsetMin: 55, dropKm: 40 },
  { name: "Ritika", hub: "LKO", to: "GKP", arriveOffsetMin: 95, dropKm: 275 },
  { name: "Aman", hub: "LKO", to: "SLN", arriveOffsetMin: 25, dropKm: 140 },
  { name: "Farhan", hub: "LKO", to: "BST", arriveOffsetMin: -120, dropKm: 205 },
  { name: "Neha", hub: "PAT", to: "CPR", arriveOffsetMin: 20, dropKm: 75 },
  { name: "Saurabh", hub: "PAT", to: "ARA", arriveOffsetMin: -25, dropKm: 60 },
  { name: "Kajal", hub: "PAT", to: "BGS", arriveOffsetMin: 45, dropKm: 125 },
  { name: "Vivek", hub: "PAT", to: "HJP", arriveOffsetMin: 10, dropKm: 25 },
  { name: "Rahul", hub: "VNS", to: "JNU", arriveOffsetMin: -20, dropKm: 70 },
  { name: "Anjali", hub: "VNS", to: "GZP", arriveOffsetMin: 30, dropKm: 80 },
  { name: "Deepak", hub: "VNS", to: "MZP", arriveOffsetMin: 50, dropKm: 75 },
];

export const festivals = [
  { name: "Diwali", date: "2026-11-08" },
  { name: "Chhath Puja", date: "2026-11-15" },
  { name: "Christmas", date: "2026-12-25" },
  { name: "New Year", date: "2027-01-01" },
  { name: "Makar Sankranti", date: "2027-01-14" },
];

export function findCity(text: string): City | undefined {
  const t = text.toLowerCase().trim();
  if (!t) return undefined;
  const exact = (c: City) => c.code.toLowerCase() === t || c.name.toLowerCase() === t || c.aliases.some((a) => a === t);
  // seed first (hand-made aliases), then airports and looked-up places; substring matching only for the seed
  return cities.find(exact) ?? [...cityByCode.values()].find(exact) ?? cities.find((c) => c.aliases.some((a) => a.length > 3 && t.includes(a)));
}

// Places outside India. Marg Bandhu plans trips within India only; these are detected without the LLM so the
// reply is always "not covered" instead of a wrong substitution. Name first, then aliases (lower-case / Devanagari).
export const notCoveredPlaces: [string, ...string[]][] = [
  ["Nepal", "nepal", "नेपाल"], ["Kathmandu", "kathmandu", "काठमांडू"], ["Dubai", "dubai", "दुबई"],
  ["Bangladesh", "bangladesh", "बांग्लादेश"], ["Dhaka", "dhaka", "ढाका"], ["Sri Lanka", "sri lanka", "श्रीलंका"],
  ["Singapore", "singapore", "सिंगापुर"], ["London", "london", "लंदन"], ["USA", "usa", "america", "अमेरिका"],
];
