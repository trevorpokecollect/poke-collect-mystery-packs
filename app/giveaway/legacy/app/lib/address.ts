// Turns the free-text country and state a winner types on the claim form into the codes
// Shopify's order address needs. Unknown values come back null (the full address also
// goes in the order note, so nothing is lost).

const US_STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "puerto rico": "PR",
  guam: "GU",
  "virgin islands": "VI",
  "american samoa": "AS",
  "northern mariana islands": "MP",
  "armed forces americas": "AA",
  "armed forces europe": "AE",
  "armed forces pacific": "AP",
};

const CA_PROVINCES: Record<string, string> = {
  alberta: "AB",
  "british columbia": "BC",
  manitoba: "MB",
  "new brunswick": "NB",
  "newfoundland and labrador": "NL",
  newfoundland: "NL",
  "northwest territories": "NT",
  "nova scotia": "NS",
  nunavut: "NU",
  ontario: "ON",
  "prince edward island": "PE",
  quebec: "QC",
  québec: "QC",
  saskatchewan: "SK",
  yukon: "YT",
};

const COUNTRIES: Record<string, string> = {
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  us: "US",
  america: "US",
  canada: "CA",
  "united kingdom": "GB",
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  australia: "AU",
  mexico: "MX",
};

const clean = (s: string) =>
  s.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");

/** ISO country code for what the winner typed, or null when it isn't recognized. */
export function countryCode(text: string): string | null {
  const t = clean(text);
  if (COUNTRIES[t]) return COUNTRIES[t];
  return /^[a-z]{2}$/.test(t) ? t.toUpperCase() : null;
}

/** State or province code for US and Canadian addresses, or null when unknown. */
export function provinceCode(
  text: string,
  country: string | null,
): string | null {
  const t = clean(text);
  if (!t) return null;
  const table =
    country === "US" ? US_STATES : country === "CA" ? CA_PROVINCES : null;
  if (!table) return null;
  if (table[t]) return table[t];
  const upper = t.toUpperCase();
  return Object.values(table).includes(upper) ? upper : null;
}

/** First word as the first name, the rest as the last name. */
export function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}
