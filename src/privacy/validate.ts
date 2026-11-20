// Checksums and format checks that keep pattern false positives low.

export const digitsOf = (s: string): string => s.replace(/\D/g, "");

/** Luhn (mod 10): cards, Canadian SIN, South African ID, Swedish personnummer. */
export function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Remainder of a long decimal string modulo m, without BigInt. */
export function mod(numeric: string, m: number): number {
  let r = 0;
  for (let i = 0; i < numeric.length; i++) r = (r * 10 + (numeric.charCodeAt(i) - 48)) % m;
  return r;
}

/** IBAN lengths by country (SWIFT IBAN registry). */
// biome-ignore format: table
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21,
  CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18,
  FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23,
  IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27,
  MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18, NO: 15, OM: 23, PK: 24, PL: 28,
  PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27,
  SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

/** ISO 13616: known country, right length, mod 97 == 1. */
export function iban(raw: string): boolean {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  const len = IBAN_LENGTHS[s.slice(0, 2)];
  if (!len || s.length !== len || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let numeric = "";
  for (const c of moved) numeric += c >= "A" ? String(c.charCodeAt(0) - 55) : c;
  return mod(numeric, 97) === 1;
}

/** Card: 13-19 digits, Luhn, a known issuer prefix, not one repeated digit. */
export function card(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length < 13 || d.length > 19 || !luhn(d) || /^(\d)\1+$/.test(d)) return false;
  const p2 = Number(d.slice(0, 2));
  const p3 = Number(d.slice(0, 3));
  const p4 = Number(d.slice(0, 4));
  const p6 = Number(d.slice(0, 6));
  const n = d.length;
  if (d[0] === "4") return n === 13 || n === 16 || n === 19; // Visa
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return n === 16; // Mastercard
  if (p2 === 34 || p2 === 37) return n === 15; // Amex
  if (p4 === 6011 || p2 === 65 || (p3 >= 644 && p3 <= 649) || (p6 >= 622126 && p6 <= 622925))
    return n >= 16 && n <= 19; // Discover
  if (p4 >= 3528 && p4 <= 3589) return n >= 16 && n <= 19; // JCB
  if (p2 === 36 || p2 === 38 || (p3 >= 300 && p3 <= 305)) return n >= 14 && n <= 19; // Diners
  if (p2 === 62) return n >= 16 && n <= 19; // UnionPay
  if (p2 === 50 || (p2 >= 56 && p2 <= 69)) return n >= 12 && n <= 19; // Maestro
  if (p4 >= 2200 && p4 <= 2204) return n === 16; // Mir
  return false;
}

/** Verhoeff checksum: Indian Aadhaar. */
// biome-ignore format: table
const V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
// biome-ignore format: table
const V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export function verhoeff(digits: string): boolean {
  let c = 0;
  const rev = [...digits].reverse();
  for (let i = 0; i < rev.length; i++) c = V_D[c]?.[V_P[i % 8]?.[Number(rev[i])] ?? 0] ?? 0;
  return c === 0;
}

/** Weighted mod 11 where the check digit is the last digit. */
function weightedMod11(digits: string, weights: number[]): number {
  let s = 0;
  for (let i = 0; i < weights.length; i++) s += Number(digits[i]) * (weights[i] ?? 0);
  return s % 11;
}

/** UK NHS number: 10 digits, mod 11. */
export function nhs(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 10) return false;
  const r = 11 - weightedMod11(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const check = r === 11 ? 0 : r;
  return check !== 10 && check === Number(d[9]);
}

/** Dutch BSN: 9 digits, "11-proof". */
export function bsn(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 9) return false;
  let s = 0;
  for (let i = 0; i < 8; i++) s += Number(d[i]) * (9 - i);
  s -= Number(d[8]);
  return s % 11 === 0 && s !== 0;
}

/** Canadian SIN: 9 digits, Luhn, first digit not 0 or 8. */
export function sin(raw: string): boolean {
  const d = digitsOf(raw);
  return d.length === 9 && d[0] !== "0" && d[0] !== "8" && luhn(d);
}

/** US SSN: area not 000/666/9xx, group not 00, serial not 0000. */
export function ssn(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 9) return false;
  const area = d.slice(0, 3);
  return area !== "000" && area !== "666" && d[0] !== "9" && d.slice(3, 5) !== "00" && d.slice(5) !== "0000";
}

/** True for a real calendar date given 2-digit year (any century), month, day. */
export function validDate(mm: number, dd: number, yy = 2000): boolean {
  if (mm < 1 || mm > 12 || dd < 1) return false;
  const days = [31, yy % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1] ?? 0;
  return dd <= days;
}

/** South African ID: YYMMDD SSSS C A Z, Luhn. */
export function zaId(raw: string): boolean {
  const d = digitsOf(raw);
  return (
    d.length === 13 &&
    validDate(Number(d.slice(2, 4)), Number(d.slice(4, 6)), Number(d.slice(0, 2))) &&
    (d[10] === "0" || d[10] === "1") &&
    luhn(d)
  );
}

/** Swedish personnummer YYMMDD-XXXX (or YYYYMMDD-XXXX): Luhn over the last 10 digits. */
export function sePnr(raw: string): boolean {
  const d = digitsOf(raw).slice(-10);
  const day = Number(d.slice(4, 6));
  return d.length === 10 && validDate(Number(d.slice(2, 4)), day > 60 ? day - 60 : day) && luhn(d);
}

/** Polish PESEL: 11 digits with a weighted checksum and an encoded date. */
export function pesel(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 11) return false;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let s = 0;
  for (let i = 0; i < 10; i++) s += Number(d[i]) * (w[i] ?? 0);
  return (
    (10 - (s % 10)) % 10 === Number(d[10]) && validDate(Number(d.slice(2, 4)) % 20, Number(d.slice(4, 6)))
  );
}

/** Spanish DNI (8 digits + letter) and NIE (X/Y/Z + 7 digits + letter): mod 23 letter. */
export function esDni(raw: string): boolean {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(s);
  if (!m) return false;
  const prefix = m[1] ? String("XYZ".indexOf(m[1])) : "";
  const num = prefix + (m[2] ?? "");
  if (num.length !== 8) return false;
  return "TRWAGMYFPDXBNJZSQVHLCKE"[Number(num) % 23] === m[3];
}

/** French NIR (numéro de sécurité sociale): 13 digits + 2-digit key = 97 - n mod 97. Corsica 2A/2B handled. */
export function frNir(raw: string): boolean {
  const s = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[12]\d{4}(?:\d{2}|2A|2B)\d{6}\d{2}$/.test(s)) return false;
  const body = s.slice(0, 13).replace("2A", "19").replace("2B", "18");
  const shift = s.includes("2A") ? 1000000 : s.includes("2B") ? 2000000 : 0;
  const key = 97 - ((mod(body, 97) - (shift % 97) + 97) % 97);
  return key === Number(s.slice(13));
}

/** Belgian national number YY.MM.DD-XXX.CC: 97 - (first 9 digits mod 97), with 2000+ variant. */
export function beNn(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 11) return false;
  const check = Number(d.slice(9));
  const body = d.slice(0, 9);
  return 97 - mod(body, 97) === check || 97 - mod(`2${body}`, 97) === check;
}

/** Italian codice fiscale: 16 chars with a check letter. */
export function itCf(raw: string): boolean {
  const s = raw.toUpperCase();
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(s))
    return false;
  const odd = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = s.charCodeAt(i);
    const v = c <= 57 ? c - 48 : c - 65;
    sum += i % 2 === 0 ? (odd[v] ?? 0) : v;
  }
  return String.fromCharCode(65 + (sum % 26)) === s[15];
}

/** Brazilian CPF: 11 digits, two mod 11 check digits. */
export function brCpf(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const c = ((s * 10) % 11) % 10;
    if (c !== Number(d[n])) return false;
  }
  return true;
}

/** Indian Aadhaar: 12 digits, first 2-9, Verhoeff. */
export function aadhaar(raw: string): boolean {
  const d = digitsOf(raw);
  return d.length === 12 && d[0] !== "0" && d[0] !== "1" && verhoeff(d);
}

/** German tax ID (Steuer-IdNr): 11 digits, ISO 7064 MOD 11,10. */
export function deTaxId(raw: string): boolean {
  const d = digitsOf(raw);
  if (d.length !== 11 || d[0] === "0") return false;
  let p = 10;
  for (let i = 0; i < 10; i++) {
    let s = (Number(d[i]) + p) % 10;
    if (s === 0) s = 10;
    p = (s * 2) % 11;
  }
  return (11 - p) % 10 === Number(d[10]);
}

/** IPv4 with no leading zeros, excluding unspecified, loopback and broadcast. */
export function ipv4(raw: string): boolean {
  const parts = raw.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) if (!/^(?:0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255) return false;
  return !/^(?:0\.0\.0\.0|127\.\d+\.\d+\.\d+|255\.255\.255\.255)$/.test(raw);
}

/** IPv6: valid groups and compression; rejects clock times and plain hex words. */
export function ipv6(raw: string): boolean {
  const s = raw.toLowerCase();
  if (s === "::" || s === "::1") return false;
  const dbl = s.split("::");
  if (dbl.length > 2) return false;
  const groups = (part: string) => (part ? part.split(":") : []);
  const head = groups(dbl[0] ?? "");
  const tail = groups(dbl[1] ?? "");
  const all = [...head, ...tail];
  if (all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return false;
  if (dbl.length === 1 ? all.length !== 8 : all.length > 7) return false;
  // "12:30:45"-style times have no letters, few groups and no compression.
  if (dbl.length === 1 && all.every((g) => /^\d{1,2}$/.test(g))) return false;
  return all.length >= 3 || dbl.length === 2;
}

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
