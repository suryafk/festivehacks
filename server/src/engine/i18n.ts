// Hand-written English + Hindi replies. Other Indian languages are translated from English with Sarvam Mayura.
import { cityByCode, notCoveredPlaces } from "./seed.ts";

type L = "en" | "hi";
export const langKey = (lang: string): L => (lang.startsWith("hi") ? "hi" : "en");
const name = (code?: string, l: L = "en") => {
  const c = code ? cityByCode.get(code) : undefined;
  if (!c) return code ?? "";
  if (l === "hi") return c.aliases.find((a) => /[ऀ-ॿ]/.test(a)) ?? c.name;
  return c.name;
};

export const fmtDate = (d: string, l: L) =>
  new Date(d + "T00:00:00+05:30").toLocaleDateString(l === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
export const rupee = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const modeWord = { en: { flight: "flight", train: "train", cab: "cab", transfer: "transfer" }, hi: { flight: "फ्लाइट", train: "ट्रेन", cab: "कैब", transfer: "ट्रांसफर" } };

export const t = {
  welcome: (l: L) =>
    l === "hi"
      ? "नमस्ते! मैं मार्ग बंधु हूँ 🙏 बताइए कहाँ से कहाँ जाना है और किस तारीख के आसपास — जैसे “26 दिसंबर के आसपास बेंगलुरु से गोंडा”।"
      : "Namaste! I'm Marg Bandhu 🙏 Tell me where you're going, from where, and around which date, e.g. “Bengaluru to Gonda around 26 Dec”.",
  askOrigin: (l: L) => (l === "hi" ? "आप कहाँ से निकलेंगे?" : "Where will you be starting from?"),
  askDestination: (l: L) => (l === "hi" ? "कहाँ जाना है? (शहर या कस्बे का नाम)" : "Where do you want to go? (city or town)"),
  askDate: (l: L, dest?: string) => (l === "hi" ? `${name(dest, l)} कब पहुँचना है? तारीख बताइए।` : `Around which date do you want to travel to ${name(dest, l)}?`),
  askModes: (l: L) =>
    l === "hi" ? "आप किन साधनों से सफ़र करने में सहज हैं — फ्लाइट, ट्रेन, कैब? (एक से ज़्यादा चुन सकते हैं)" : "Which modes are you comfortable with: flight, train, cab? (pick any)",
  heard: (l: L, text: string) => (l === "hi" ? `🎙️ मैंने सुना: “${text}”` : `🎙️ I heard: “${text}”`),
  notCovered: (l: L, places: string[]) =>
    l === "hi"
      ? `माफ़ कीजिए, ${places.map((p) => notCoveredPlaces.find(([n]) => n === p)?.find((a) => /[\u0900-\u097F]/.test(a)) ?? p).join(" और ")} अभी मार्ग बंधु पर उपलब्ध नहीं है। अभी हम बेंगलुरु, दिल्ली, मुंबई और हैदराबाद से उत्तर प्रदेश और बिहार के शहरों (जैसे लखनऊ, गोरखपुर, गोंडा, अयोध्या, पटना, आरा, वाराणसी, जौनपुर) तक की यात्रा प्लान करते हैं। कहीं और जाना हो तो बताइए!`
      : `Sorry, ${places.join(" and ")} ${places.length > 1 ? "aren't" : "isn't"} on Marg Bandhu yet. Right now we plan trips from Bengaluru, Delhi, Mumbai and Hyderabad to towns in Uttar Pradesh and Bihar (e.g. Lucknow, Gorakhpur, Gonda, Ayodhya, Patna, Ara, Varanasi, Jaunpur). Want to try one of those?`,
  coverage: (l: L) =>
    l === "hi"
      ? "अभी हम बेंगलुरु, दिल्ली, मुंबई या हैदराबाद से उत्तर प्रदेश और बिहार के शहरों तक की यात्रा प्लान करते हैं। कहाँ से कहाँ जाना है?"
      : "Right now we plan trips from Bengaluru, Delhi, Mumbai or Hyderabad to towns in Uttar Pradesh and Bihar. Where from, and where to?",
  noRoute: (l: L) => (l === "hi" ? "माफ़ कीजिए, इन साधनों से कोई रास्ता नहीं मिला। कोई और साधन जोड़कर देखें?" : "Sorry, I couldn't find a route with those modes. Want to allow another mode?"),
  planIntro: (l: L, trip: { origin?: string; destination?: string; date?: string }) =>
    l === "hi"
      ? `${name(trip.origin, l)} → ${name(trip.destination, l)}, ${fmtDate(trip.date!, l)} के आसपास — आपका प्लान तैयार है:`
      : `${name(trip.origin, l)} → ${name(trip.destination, l)} around ${fmtDate(trip.date!, l)}: here's your plan.`,
  legLine: (l: L, leg: { mode: string; from: string; to: string; depart: number; arrive: number; name: string }) =>
    `${modeWord[l][leg.mode as keyof (typeof modeWord)["en"]] ?? leg.mode} ${fmtTime(leg.depart)}→${fmtTime(leg.arrive)} ${leg.name}`,
  nudge: (l: L, variant: "urgent" | "savings", a: { verdict: string; riseAfter?: string; savings: number; bestBookBy: string; currentFare: number; festival?: string }) => {
    if (a.verdict === "wait")
      return l === "hi"
        ? `💡 अभी रुकिए: ${fmtDate(a.bestBookBy, l)} तक बुक करने पर लगभग ${rupee(a.savings)} बच सकते हैं।`
        : `💡 Wait a little: booking by ${fmtDate(a.bestBookBy, l)} should save about ${rupee(a.savings)}.`;
    const fest = a.festival ? (l === "hi" ? ` (${a.festival} की भीड़)` : ` (${a.festival} rush)`) : "";
    if (a.verdict === "monitor")
      return l === "hi"
        ? `👀 किराया गिर सकता है${fest}। मैं नज़र रखूँ? गिरते ही सूचना दूँगा।`
        : `👀 There's a fair chance this fare dips${fest}. Want me to watch it and alert you when it drops?`;
    if (variant === "urgent")
      return l === "hi"
        ? `⏰ अभी बुक करें${fest}: ${a.riseAfter ? fmtDate(a.riseAfter, l) + " के बाद" : "जल्द ही"} किराया तेज़ी से बढ़ेगा।`
        : `⏰ Book now${fest}: fares climb sharply ${a.riseAfter ? "after " + fmtDate(a.riseAfter, l) : "soon"}.`;
    return l === "hi"
      ? `💰 आज ${rupee(a.currentFare)} सबसे अच्छा दाम है${fest} — आखिरी समय से काफ़ी सस्ता।`
      : `💰 ${rupee(a.currentFare)} today is about as good as it gets${fest}, far cheaper than last-minute.`;
  },
  poolPreview: (l: L, n: number, town: string) =>
    n > 0
      ? l === "hi"
        ? `🚕 ${n} और यात्री उसी समय ${name(town, l)} की तरफ़ जा रहे हैं। कैब शेयर करें? “pool” लिखें।`
        : `🚕 ${n} other traveller${n > 1 ? "s are" : " is"} heading towards ${name(town, l)} at the same time. Share a cab? Reply “pool”.`
      : l === "hi"
        ? `🚕 अभी कोई सह-यात्री नहीं है — “pool” लिखें, कोई जुड़ते ही मैं बता दूँगा।`
        : `🚕 No co-travellers yet. Reply “pool” and I'll ping you the moment someone joins.`,
  poolWaiting: (l: L) =>
    l === "hi" ? "👀 मैं नज़र रख रहा हूँ — जैसे ही कोई आपके रास्ते पर जुड़ेगा, आपको सूचना मिलेगी।" : "👀 I'm watching. You'll get a notification as soon as someone on your route joins.",
  poolMatched: (l: L, members: string[], pays: number, saves: number, departAt: number) =>
    l === "hi"
      ? `🎉 पूल मिल गया! आपके साथ: ${members.join(", ")}। आपका हिस्सा ${rupee(pays)} (बचत ${rupee(saves)})। कैब ${fmtTime(departAt)} बजे निकलेगी।`
      : `🎉 Pool found! Riding with ${members.join(", ")}. Your share is ${rupee(pays)} (you save ${rupee(saves)}). Cab leaves at ${fmtTime(departAt)}.`,
  poolOff: (l: L) => (l === "hi" ? "कैब पूलिंग अभी आपके शहर में शुरू नहीं हुई है।" : "Cab pooling isn't live for this route yet."),
  noPoolable: (l: L) => (l === "hi" ? "इस प्लान में कैब वाला हिस्सा नहीं है। कैब को साधनों में जोड़ें?" : "This plan has no cab leg to pool. Want to allow cabs?"),
  reset: (l: L) => (l === "hi" ? "ठीक है, नई यात्रा शुरू करते हैं।" : "Okay, let's plan a new trip."),
  degraded: (l: L) => (l === "hi" ? "(त्योहार की भीड़ के कारण अपडेट थोड़ा धीमे आ सकते हैं)" : "(festive rush: updates may be a little slower)"),
};

export { name as cityName };
