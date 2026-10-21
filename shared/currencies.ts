/** Symbols are the ones people write locally, made distinct where two would clash (CN¥ vs ¥, CA$ vs $). */
/** The currency of a country (ISO region), for the ones in CURRENCIES. */
const BY_REGION: Record<string, string> = {
  US: "USD", GB: "GBP", IN: "INR", JP: "JPY", KR: "KRW", CN: "CNY", AU: "AUD", CA: "CAD", CH: "CHF", LI: "CHF", SG: "SGD", HK: "HKD", NZ: "NZD",
  SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF", RU: "RUB", TR: "TRY", BR: "BRL", MX: "MXN", AR: "ARS", CL: "CLP", CO: "COP",
  ZA: "ZAR", NG: "NGN", KE: "KES", EG: "EGP", AE: "AED", SA: "SAR", IL: "ILS", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", TH: "THB", VN: "VND",
  ID: "IDR", MY: "MYR", PH: "PHP", TW: "TWD",
  ...Object.fromEntries("AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ").map((r) => [r, "EUR"])),
};
/** Time zones that name the country better than a browser language like "en-US" does. */
const BY_ZONE: Record<string, string> = { "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Dubai": "AE", "Asia/Singapore": "SG", "Asia/Karachi": "PK", "Asia/Dhaka": "BD", "Asia/Kathmandu": "NP", "Asia/Colombo": "LK", "Europe/London": "GB" };

/** A first guess at the user's main currency, from their time zone or browser language; null when neither says. */
export function guessCurrency(languages: readonly string[], timeZone?: string): string | null {
  const regions = [timeZone ? BY_ZONE[timeZone] : undefined, ...languages.map((l) => { try { return new Intl.Locale(l).maximize().region; } catch { return undefined; } })];
  for (const r of regions) if (r && BY_REGION[r]) return BY_REGION[r];
  return null;
}

export type CurrencyInfo = { code: string; name: string; symbol: string; decimals: number; position?: "before" | "after" };

export const CURRENCIES: CurrencyInfo[] = [
  { code: "USD", name: "US Dollar", symbol: "$", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", decimals: 2 },
  { code: "INR", name: "Indian Rupee", symbol: "₹", decimals: 2 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", decimals: 0 },
  { code: "KRW", name: "South Korean Won", symbol: "₩", decimals: 0 },
  { code: "CNY", name: "Chinese Yuan", symbol: "CN¥", decimals: 2 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", decimals: 2 },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", decimals: 2 },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", decimals: 2 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", decimals: 2 },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", decimals: 2 },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", decimals: 2 },
  { code: "SEK", name: "Swedish Krona", symbol: "kr", decimals: 2, position: "after" },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr", decimals: 2, position: "after" },
  { code: "DKK", name: "Danish Krone", symbol: "kr", decimals: 2, position: "after" },
  { code: "PLN", name: "Polish Zloty", symbol: "zł", decimals: 2, position: "after" },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč", decimals: 2, position: "after" },
  { code: "HUF", name: "Hungarian Forint", symbol: "Ft", decimals: 0, position: "after" },
  { code: "RUB", name: "Russian Ruble", symbol: "₽", decimals: 2, position: "after" },
  { code: "TRY", name: "Turkish Lira", symbol: "₺", decimals: 2 },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", decimals: 2 },
  { code: "MXN", name: "Mexican Peso", symbol: "MX$", decimals: 2 },
  { code: "ARS", name: "Argentine Peso", symbol: "AR$", decimals: 2 },
  { code: "CLP", name: "Chilean Peso", symbol: "CLP$", decimals: 0 },
  { code: "COP", name: "Colombian Peso", symbol: "COL$", decimals: 0 },
  { code: "ZAR", name: "South African Rand", symbol: "R", decimals: 2 },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", decimals: 2 },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", decimals: 2 },
  { code: "EGP", name: "Egyptian Pound", symbol: "E£", decimals: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "AED", decimals: 2 },
  { code: "SAR", name: "Saudi Riyal", symbol: "SAR", decimals: 2 },
  { code: "ILS", name: "Israeli Shekel", symbol: "₪", decimals: 2 },
  { code: "PKR", name: "Pakistani Rupee", symbol: "Rs", decimals: 0 },
  { code: "BDT", name: "Bangladeshi Taka", symbol: "৳", decimals: 2 },
  { code: "LKR", name: "Sri Lankan Rupee", symbol: "Rs", decimals: 2 },
  { code: "NPR", name: "Nepalese Rupee", symbol: "Rs", decimals: 2 },
  { code: "THB", name: "Thai Baht", symbol: "฿", decimals: 2 },
  { code: "VND", name: "Vietnamese Dong", symbol: "₫", decimals: 0, position: "after" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", decimals: 0 },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", decimals: 2 },
  { code: "PHP", name: "Philippine Peso", symbol: "₱", decimals: 2 },
  { code: "TWD", name: "New Taiwan Dollar", symbol: "NT$", decimals: 0 },
  { code: "BTC", name: "Bitcoin", symbol: "₿", decimals: 8 },
];

export function currencyInfo(code: string): CurrencyInfo | undefined {
  return CURRENCIES.find((c) => c.code === code);
}
