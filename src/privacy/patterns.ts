// Tier 0 PII patterns. Each pattern is a regex plus an optional validator.
// Standard: contact, financial and government identifiers. Strict adds names, organisations and
// addresses, but only where a label or structure makes them reliable (free-text names need a model).
import type { PiiType } from "./detector.ts";
import * as v from "./validate.ts";

export interface PiiPattern {
  id: string;
  type: PiiType;
  level: "standard" | "strict";
  /** Plain-words description for `pmcpg privacy explain`. */
  about: string;
  re: RegExp;
  /** Capture group holding the value; 0 = whole match. */
  group?: number;
  confidence: number;
  /** Return false to reject. `before` is up to 40 characters preceding the value. */
  check?: (value: string, before: string) => boolean;
}

/** Builds a global regex with indices (d) and unicode (u). Labels use (?i:...) so \p{Lu} stays case-sensitive. */
const re = (src: string) => new RegExp(src, "gdu");

/**
 * A label then a separator, e.g. `Phone: `, `"first_name": "`, `BSN 111222333`. Value goes in group 1.
 * Names, organisations and addresses need an explicit separator (`:`, `=`); IDs and numbers do not.
 */
const labelled = (labels: string, value: string, sepRequired = false) =>
  re(
    `(?<![\\p{L}\\p{N}_])["']?(?i:${labels})["']?[ \\t]*(?:[:=#]|\\bis\\b|-)${sepRequired ? "" : "?"}[ \\t]*["']?(${value})`,
  );

/** Not preceded by these (case-insensitive), e.g. "order 4111..." is not a card. */
const notAfter = (words: string) => {
  const r = new RegExp(`\\b(?:${words})(?:[\\s.:#°º-]*(?:no|nr|num|number|n°|id))?[\\s.:#°º-]*$`, "i");
  return (before: string) => !r.test(before);
};

const CAP = "\\p{Lu}[\\p{L}'’.-]*";
const CAP_NAME = `${CAP}(?:[ \\t]+(?:${CAP}|de|da|del|dos|van|von|der|den|di|du|la|le|bin|binti|wa|al|el)){0,4}`;
const NOT_DIGIT_OR_WORD_AFTER = "(?![\\p{L}\\p{N}_-]|[.,]\\d)";
const START = "(?<![\\p{L}\\p{N}_.+-])";

const FILE_EXT = /^(?:png|jpe?g|gif|svg|webp|ico|js|mjs|ts|css|html?|json|map|pdf|zip)$/i;

/** "01 02 2024", "07 11 2026 14": groups that read as a date. */
const looksLikeDate = (s: string) => /^\d{1,2}[ ./-]\d{1,2}[ ./-](?:19|20)\d{2}\b/.test(s);

const NOT_A_PHONE = notAfter(
  "order|invoice|tracking|ref|reference|ticket|case|transaction|txn|account|acct|iban|card|isbn|serial|version|v|id",
);

const phoneDigits = (min: number, max: number) => (value: string) => {
  const n = v.digitsOf(value).length;
  return n >= min && n <= max && !looksLikeDate(value) && !/^(\d)\1+$/.test(v.digitsOf(value));
};

const ID_LABELS =
  "national[ \\t]+id(?:entity)?(?:[ \\t]+(?:card|number|no\\.?|#))?|identity[ \\t]+(?:card|number|no\\.?)|id[ \\t]+(?:card[ \\t]+)?(?:number|no\\.?|#)|citizen[ \\t]+id|voter(?:'s)?[ \\t]+id|passport(?:[ \\t]+(?:number|no\\.?|#))?|nin|bvn|huduma(?:[ \\t]+namba)?|kitambulisho(?:[ \\t]+namba)?|ghana[ \\t]+card|c[ée]dula(?:[ \\t]+de[ \\t]+identidad)?|dni|nie|curp|num[ée]ro[ \\t]+d['’]identit[ée]|carte[ \\t]+d['’]identit[ée]|personalausweis(?:nummer)?|ausweisnummer|driver'?s?[ \\t]+licen[cs]e(?:[ \\t]+(?:number|no\\.?|#))?|health[ \\t]+card(?:[ \\t]+(?:number|no\\.?))?|medicare(?:[ \\t]+(?:number|no\\.?))?";

/** "Order ID number:" and similar are not personal IDs. */
const NOT_PERSONAL_ID =
  /\b(?:order|user|customer|client|transaction|account|record|ticket|case|product|session|request|invoice|item|task|issue|job|message|event|device|app|tenant|project)[ \t_-]+id\b[^\n]{0,20}$/i;

/** "File name:", "project_name" and similar are not people. */
const NOT_A_PERSON_NAME =
  /\b(?:file|project|repo|repository|product|company|org|organi[sz]ation|app|application|domain|host|server|tool|channel|folder|team|event|task|field|column|table|database|bucket|branch|package|module|class|function|account|brand|item|document|sheet|tab|group|list|page|site|key|host|device|model|plan|course|program(?:me)?|campaign|fund|grant)[ \t_-]?name["']?[ \t]*(?:[:=#]|\bis\b|-)[ \t]*["']?$/i;

export const PATTERNS: PiiPattern[] = [
  // Contact
  {
    id: "email",
    type: "EMAIL",
    level: "standard",
    about: "Email addresses",
    re: re(
      `(?<![\\p{L}\\p{N}._%+-])[\\p{L}\\p{N}._%+-]{1,64}@(?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?\\.)+\\p{L}{2,24}(?![\\p{L}\\p{N}-])`,
    ),
    confidence: 0.99,
    check: (value) => {
      const [local = "", domain = ""] = value.split("@");
      return !/^\.|\.$/.test(local) && !FILE_EXT.test(domain.split(".").pop() ?? "");
    },
  },
  {
    id: "phone-intl",
    type: "PHONE",
    level: "standard",
    about: "Phone numbers in international format (+44 20 7946 0958)",
    re: re(`(?<![\\p{L}\\p{N}_+])\\+[1-9](?:[ .\\-\\u00A0]?\\(?\\d\\)?){6,14}${NOT_DIGIT_OR_WORD_AFTER}`),
    confidence: 0.9,
    check: phoneDigits(8, 15),
  },
  {
    id: "phone-nanp",
    type: "PHONE",
    level: "standard",
    about: "North American phone numbers ((613) 555-0142, 613-555-0142)",
    re: re(
      `${START}(?:1[ .-]?)?(?:\\([2-9]\\d{2}\\)[ .-]?|[2-9]\\d{2}[ .-])[2-9]\\d{2}[ .-]\\d{4}${NOT_DIGIT_OR_WORD_AFTER}`,
    ),
    confidence: 0.8,
    check: (value, before) => NOT_A_PHONE(before) && phoneDigits(10, 11)(value),
  },
  {
    id: "phone-national",
    type: "PHONE",
    level: "standard",
    about: "National phone numbers with a leading 0 and spaced groups (020 7946 0958, 0712 345 678)",
    re: re(`${START}0[1-9]\\d{0,3}(?:[ \\-\\u00A0]\\d{2,4}){2,4}${NOT_DIGIT_OR_WORD_AFTER}`),
    confidence: 0.7,
    check: (value, before) => NOT_A_PHONE(before) && phoneDigits(9, 12)(value),
  },
  {
    id: "phone-labelled",
    type: "PHONE",
    level: "standard",
    about: "Numbers after a phone label (Tel:, Phone:, Mobile:, Simu:, Téléphone:)",
    re: labelled(
      "tel(?:ephone|[ée]fono|efon|[ée]phone)?|phone(?:[ \\t]+(?:number|no\\.?))?|mobile|cell(?:phone)?|mob|fax|whatsapp|simu|nambari[ \\t]+ya[ \\t]+simu|portable|handy|telefone|celular|m[óo]vil|rununu|contact[ \\t]+number",
      "\\+?\\(?\\d[\\d ().\\-\\u00A0]{5,18}\\d",
    ),
    group: 1,
    confidence: 0.85,
    check: phoneDigits(7, 15),
  },

  // Financial
  {
    id: "card",
    type: "CARD",
    level: "standard",
    about: "Payment card numbers (Luhn checksum and known issuer prefix)",
    re: re(`(?<![\\p{L}\\p{N}_.-])\\d(?:[ -]?\\d){11,18}${NOT_DIGIT_OR_WORD_AFTER}`),
    confidence: 0.9,
    check: (value, before) =>
      v.card(value) &&
      notAfter("order|invoice|tracking|ref|reference|ticket|transaction|txn|commande|pedido")(before),
  },
  {
    id: "iban",
    type: "IBAN",
    level: "standard",
    about: "IBANs (country length and mod-97 checksum)",
    re: re(`(?<![\\p{L}\\p{N}_])[A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![\\p{L}\\p{N}_])`),
    confidence: 0.95,
    check: (value) => v.iban(value),
  },

  // Network
  {
    id: "ipv4",
    type: "IP",
    level: "standard",
    about: "IPv4 addresses (not version numbers, loopback or 0.0.0.0)",
    re: re(`(?<![\\p{L}\\p{N}_.:-])(?:\\d{1,3}\\.){3}\\d{1,3}(?![\\p{L}\\p{N}_-]|\\.\\d)`),
    confidence: 0.85,
    check: (value, before) => v.ipv4(value) && notAfter("v|version|ver|release|build|firmware|rev")(before),
  },
  {
    id: "ipv6",
    type: "IP",
    level: "standard",
    about: "IPv6 addresses",
    re: re(`(?<![\\p{L}\\p{N}_:.])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\\p{L}\\p{N}_:.])`),
    confidence: 0.85,
    check: (value) => v.ipv6(value) && /\d/.test(value) && value.replace(/:/g, "").length >= 4,
  },

  // Government identifiers
  {
    id: "us-ssn",
    type: "NATIONAL_ID",
    level: "standard",
    about: "US Social Security numbers (123-45-6789)",
    re: re(`${START}\\d{3}([- ])\\d{2}\\1\\d{4}${NOT_DIGIT_OR_WORD_AFTER}`),
    confidence: 0.85,
    check: (value) => v.ssn(value),
  },
  {
    id: "us-ssn-labelled",
    type: "NATIONAL_ID",
    level: "standard",
    about: "US Social Security numbers after an SSN label",
    re: labelled("ssn|social[ \\t]+security(?:[ \\t]+(?:number|no\\.?|#))?", "\\d{3}[ -]?\\d{2}[ -]?\\d{4}"),
    group: 1,
    confidence: 0.95,
    check: (value) => v.ssn(value),
  },
  {
    id: "ca-sin",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Canadian Social Insurance Numbers (Luhn checksum)",
    re: re(`${START}\\d{3}([- ])\\d{3}\\1\\d{3}${NOT_DIGIT_OR_WORD_AFTER}`),
    confidence: 0.8,
    check: (value) => v.sin(value),
  },
  {
    id: "ca-sin-labelled",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Canadian SIN after a SIN or NAS label",
    re: labelled(
      "sin|social[ \\t]+insurance(?:[ \\t]+(?:number|no\\.?|#))?|nas|num[ée]ro[ \\t]+d['’]assurance[ \\t]+sociale",
      "\\d{3}[ -]?\\d{3}[ -]?\\d{3}",
    ),
    group: 1,
    confidence: 0.95,
    check: (value) => v.sin(value),
  },
  {
    id: "uk-nino",
    type: "NATIONAL_ID",
    level: "standard",
    about: "UK National Insurance numbers (QQ 12 34 56 C)",
    re: re(
      "(?<![\\p{L}\\p{N}_])(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\\d{2} ?\\d{2} ?\\d{2} ?[A-D](?![\\p{L}\\p{N}_])",
    ),
    confidence: 0.9,
  },
  {
    id: "uk-nhs",
    type: "NATIONAL_ID",
    level: "standard",
    about: "UK NHS numbers after an NHS label (mod-11 checksum)",
    re: labelled("nhs(?:[ \\t]+(?:number|no\\.?|#))?", "\\d{3}[ -]?\\d{3}[ -]?\\d{4}"),
    group: 1,
    confidence: 0.95,
    check: (value) => v.nhs(value),
  },
  {
    id: "in-aadhaar",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Indian Aadhaar numbers (Verhoeff checksum)",
    re: re(`${START}[2-9]\\d{3}([ -])\\d{4}\\1\\d{4}${NOT_DIGIT_OR_WORD_AFTER}`),
    confidence: 0.85,
    check: (value) => v.aadhaar(value),
  },
  {
    id: "in-pan",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Indian PAN numbers (ABCPE1234F)",
    re: re("(?<![\\p{L}\\p{N}_])[A-Z]{3}[ABCFGHJLPT][A-Z]\\d{4}[A-Z](?![\\p{L}\\p{N}_])"),
    confidence: 0.75,
  },
  {
    id: "za-id",
    type: "NATIONAL_ID",
    level: "standard",
    about: "South African ID numbers (birth date and Luhn checksum)",
    re: re(`${START}\\d{13}${NOT_DIGIT_OR_WORD_AFTER}`),
    confidence: 0.8,
    check: (value) => v.zaId(value),
  },
  {
    id: "ke-kra-pin",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Kenyan KRA PINs (A123456789B)",
    re: re("(?<![\\p{L}\\p{N}_])[AP]\\d{9}[A-Z](?![\\p{L}\\p{N}_])"),
    confidence: 0.85,
  },
  {
    id: "gh-card",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Ghana Card numbers (GHA-123456789-0)",
    re: re("(?<![\\p{L}\\p{N}_])GHA-\\d{9}-\\d(?![\\p{L}\\p{N}_])"),
    confidence: 0.95,
  },
  {
    id: "ug-nin",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Ugandan National Identification Numbers (CM/CF + 12 characters)",
    re: re("(?<![\\p{L}\\p{N}_])C[MF]\\d{2}[A-Z0-9]{10}(?![\\p{L}\\p{N}_])"),
    confidence: 0.75,
    check: (value) => v.digitsOf(value).length >= 6,
  },
  {
    id: "se-personnummer",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Swedish personal identity numbers (YYMMDD-XXXX, Luhn)",
    re: re(`${START}(?:19|20)?\\d{6}[-+]\\d{4}${NOT_DIGIT_OR_WORD_AFTER}`),
    confidence: 0.8,
    check: (value) => v.sePnr(value),
  },
  {
    id: "es-dni",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Spanish DNI and NIE numbers (check letter)",
    re: re("(?<![\\p{L}\\p{N}_])[XYZ]?\\d{7,8}[ -]?[A-Z](?![\\p{L}\\p{N}_])"),
    confidence: 0.85,
    check: (value) => v.esDni(value),
  },
  {
    id: "fr-nir",
    type: "NATIONAL_ID",
    level: "standard",
    about: "French social security numbers (NIR, mod-97 key)",
    re: re(
      "(?<![\\p{L}\\p{N}_])[12] ?\\d{2} ?(?:0[1-9]|1[0-2]|[2-9]\\d) ?(?:\\d{2}|2A|2B) ?\\d{3} ?\\d{3} ?\\d{2}(?![\\p{L}\\p{N}_])",
    ),
    confidence: 0.9,
    check: (value) => v.frNir(value),
  },
  {
    id: "be-nn",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Belgian national register numbers (YY.MM.DD-XXX.CC)",
    re: re("(?<![\\p{L}\\p{N}_])\\d{2}\\.\\d{2}\\.\\d{2}-\\d{3}\\.\\d{2}(?![\\p{L}\\p{N}_])"),
    confidence: 0.9,
    check: (value) => v.beNn(value),
  },
  {
    id: "it-cf",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Italian fiscal codes (codice fiscale, check letter)",
    re: re(
      "(?<![\\p{L}\\p{N}_])[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z](?![\\p{L}\\p{N}_])",
    ),
    confidence: 0.95,
    check: (value) => v.itCf(value),
  },
  {
    id: "pl-pesel",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Polish PESEL numbers after a PESEL label",
    re: labelled("pesel", "\\d{11}"),
    group: 1,
    confidence: 0.95,
    check: (value) => v.pesel(value),
  },
  {
    id: "de-tax-id",
    type: "NATIONAL_ID",
    level: "standard",
    about: "German tax IDs (Steuer-IdNr) after a label",
    re: labelled(
      "steuer-?id(?:entifikationsnummer)?|steuer-?idnr\\.?|identifikationsnummer|tax[ \\t]+id",
      "\\d{2} ?\\d{3} ?\\d{3} ?\\d{3}",
    ),
    group: 1,
    confidence: 0.95,
    check: (value) => v.deTaxId(value),
  },
  {
    id: "nl-bsn",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Dutch citizen service numbers (BSN) after a label",
    re: labelled("bsn|burgerservicenummer", "\\d{4}[ .]?\\d{2}[ .]?\\d{3}|\\d{9}"),
    group: 1,
    confidence: 0.95,
    check: (value) => v.bsn(value),
  },
  {
    id: "br-cpf",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Brazilian CPF numbers (two check digits)",
    re: re(`${START}\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}${NOT_DIGIT_OR_WORD_AFTER}`),
    confidence: 0.95,
    check: (value) => v.brCpf(value),
  },
  {
    id: "mx-curp",
    type: "NATIONAL_ID",
    level: "standard",
    about: "Mexican CURP codes",
    re: re(
      "(?<![\\p{L}\\p{N}_])[A-Z][AEIOUX][A-Z]{2}\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])[HMX](?:AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\\d]\\d(?![\\p{L}\\p{N}_])",
    ),
    confidence: 0.95,
  },
  {
    id: "id-labelled",
    type: "NATIONAL_ID",
    level: "standard",
    about: "ID, passport and licence numbers after a label (National ID:, Passport No:, NIN:, Huduma Namba:)",
    re: labelled(ID_LABELS, "[A-Z0-9](?:[A-Z0-9]|[ -](?=[A-Z0-9])){4,19}"),
    group: 1,
    confidence: 0.9,
    check: (value, before) => (value.match(/\d/g)?.length ?? 0) >= 4 && !NOT_PERSONAL_ID.test(before),
  },

  // Strict: people
  {
    id: "person-labelled",
    type: "PERSON",
    level: "strict",
    about: "Names after a label (Name:, Patient:, Nom :, Nombre:, Jina:) or in name fields",
    re: labelled(
      "(?:full|first|last|given|family|middle|display|contact|patient|client|customer|beneficiary|applicant|guardian|parent|child|member|donor|student|employee)?[ _]?name|surname|fullname|firstname|lastname|patient|beneficiary|applicant|guardian|next[ \\t]+of[ \\t]+kin|nom(?:[ \\t]+complet)?|pr[ée]nom|nombre(?:[ \\t]+completo)?|apellidos?|vorname|nachname|jina(?:[ \\t]+kamili)?",
      CAP_NAME,
      true,
    ),
    group: 1,
    confidence: 0.85,
    check: (_value, before) => !NOT_A_PERSON_NAME.test(before),
  },
  {
    id: "person-before-email",
    type: "PERSON",
    level: "strict",
    about: "Names written before an email address (Jane Doe <jane@example.org>)",
    re: re(`(?<![\\p{L}\\p{N}_])(${CAP}(?:[ \\t]+${CAP}){1,3})"?[ \\t]*<[^<>\\s@]+@`),
    group: 1,
    confidence: 0.85,
  },
  {
    id: "person-honorific",
    type: "PERSON",
    level: "strict",
    about: "Names after a title (Mr, Mrs, Ms, Dr, Prof, Mme, Sra, Herr, Frau)",
    re: re(
      `(?<![\\p{L}\\p{N}_])(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Mme|Mlle|Sr|Sra|Srta|Herr|Frau|Bw|Bi)\\.?[ \\t]+(${CAP}(?:[ \\t]+${CAP}){0,2})`,
    ),
    group: 1,
    confidence: 0.8,
  },
  {
    id: "person-greeting",
    type: "PERSON",
    level: "strict",
    about: "Names after a letter greeting (Dear Jane, Chère Marie, Estimado Juan)",
    re: re(
      `(?<![\\p{L}\\p{N}_])(?:Dear|Cher|Chère|Estimad[oa]|Querid[oa]|Liebe[r]?|Mpendwa)[ \\t]+(${CAP}(?:[ \\t]+${CAP}){0,2})[ \\t]*[,!:\\n]`,
    ),
    group: 1,
    confidence: 0.8,
    check: (value) =>
      !/^(?:Sir|Madam|Sir\/Madam|Team|All|Colleagues|Customer|Customers|Friends|Members|Partners|Board|Committee|Supporter|Supporters|Donor|Donors|Applicant|Valued|Hiring|Manager|Recipient|Parents|Everyone)\b/.test(
        value,
      ),
  },
  {
    id: "person-signoff",
    type: "PERSON",
    level: "strict",
    about: "Two- or three-word names on the line after a sign-off (Regards, / Jane Doe)",
    re: re(
      `(?<![\\p{L}\\p{N}_])(?:Regards|Best|Sincerely|Cheers|Thanks|Thank you|Kind regards|Best regards|Cordialement|Saludos|Atentamente|Mit freundlichen Grüßen|Viele Grüße|Asante)[,!.]?[ \\t]*\\r?\\n[ \\t]*(${CAP}(?:[ \\t]+${CAP}){1,2})[ \\t]*(?=\\r?\\n|$)`,
    ),
    group: 1,
    confidence: 0.75,
  },

  // Strict: organisations
  {
    id: "org-labelled",
    type: "ORG",
    level: "strict",
    about: "Organisations after a label (Company:, Organisation:, Employer:, Entreprise :, Empresa:)",
    re: labelled(
      "company(?:[ _]name)?|organi[sz]ation(?:[ _]name)?|employer|organisme|entreprise|soci[ée]t[ée]|empresa|organizaci[óo]n|firma|unternehmen|shirika|school|institution|agency",
      "[\\p{Lu}\\p{N}][\\p{L}\\p{N}&'’.-]*(?:[ \\t]+(?:[\\p{Lu}\\p{N}&][\\p{L}\\p{N}&'’.-]*|of|for|and|de|des|du|la|le|el|y|und|für|the)){0,6}",
      true,
    ),
    group: 1,
    confidence: 0.8,
  },
  {
    id: "org-suffix",
    type: "ORG",
    level: "strict",
    about: "Company names with a legal suffix (Acme Ltd, Globex Inc., Beispiel GmbH)",
    re: re(
      `(?<![\\p{L}\\p{N}_])${CAP}(?:[ \\t]+(?:${CAP}|&|and|of|for)){0,3},?[ \\t]+(?:Inc|Incorporated|Ltd|Limited|LLC|LLP|PLC|plc|Corp|Corporation|GmbH|AG|SAS|SARL|S\\.A\\.|S\\.L\\.|B\\.V\\.|N\\.V\\.|Pty|Foundation|Trust|Association|Society|Cooperative)(?![\\p{L}\\p{N}_])\\.?`,
    ),
    confidence: 0.75,
    check: (value) =>
      !/^(?:The|A|An|Our|Your|This|That|Each|Every|Any)\s/.test(value) || value.split(/\s+/).length > 2,
  },

  // Strict: addresses
  {
    id: "address-labelled",
    type: "ADDRESS",
    level: "strict",
    about: "Addresses after a label (Address:, Adresse :, Dirección:, Anwani:)",
    re: labelled(
      "(?:street|home|mailing|postal|billing|shipping|residential)?[ _]?address|adresse|direcci[óo]n|anschrift|endere[çc]o|anwani|domicile|domicilio",
      '[\\p{L}\\p{N}][^\\n\\r"<>{}\\[\\]]{4,118}[\\p{L}\\p{N}.]',
      true,
    ),
    group: 1,
    confidence: 0.85,
    check: (value) => /\d/.test(value) || value.trim().split(/\s+/).length >= 3,
  },
  {
    id: "address-street",
    type: "ADDRESS",
    level: "strict",
    about: "Street addresses (221B Baker Street, 12 rue de la Paix, Hauptstraße 5)",
    re: re(
      `(?<![\\p{L}\\p{N}_])(?:\\d{1,5}[A-Za-z]?(?:[ \\t]+${CAP}){1,4}[ \\t]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Crescent|Cres|Place|Pl|Terrace|Highway|Hwy|Parkway|Pkwy|Square|Sq|Close|Gardens)\\b\\.?|\\d{1,5}(?:[ \\t]?(?:bis|ter))?,?[ \\t]+(?:rue|avenue|boulevard|bd|chemin|all[ée]e|impasse|quai|route|place)[ \\t]+(?:(?:de|du|des|la|le|l['’]|d['’])[ \\t]*)*${CAP}(?:[ \\t]+${CAP}){0,3}|(?:Calle|Avenida|Paseo|Plaza|Carrera|Rua)[ \\t]+(?:(?:de|del|la|los|las)[ \\t]+)*${CAP}(?:[ \\t]+${CAP}){0,3},?[ \\t]+\\d{1,5}|${CAP}(?:straße|strasse|weg|gasse|platz|allee)[ \\t]+\\d{1,4}[a-z]?)(?![\\p{L}\\p{N}_])`,
    ),
    confidence: 0.8,
  },
  {
    id: "address-po-box",
    type: "ADDRESS",
    level: "strict",
    about: "Post office boxes (P.O. Box 12345-00100, BP 123, Apartado 45)",
    re: re(
      "(?<![\\p{L}\\p{N}_])(?:P\\.?[ \\t]?O\\.?[ \\t]?Box|Post[ \\t]+Office[ \\t]+Box|BP|Bo[îi]te[ \\t]+postale|Apartado(?:[ \\t]+postal)?|Postfach|S\\.?L\\.?P\\.?)[ \\t]*\\d{1,6}(?:[ \\t]*[-–][ \\t]*\\d{3,6})?(?![\\p{L}\\p{N}_])",
    ),
    confidence: 0.9,
  },
  {
    id: "postcode-ca",
    type: "ADDRESS",
    level: "strict",
    about: "Canadian postal codes (K1A 0B1)",
    re: re(
      "(?<![\\p{L}\\p{N}_])[ABCEGHJ-NPRSTVXY]\\d[ABCEGHJ-NPRSTV-Z][ -]?\\d[ABCEGHJ-NPRSTV-Z]\\d(?![\\p{L}\\p{N}_])",
    ),
    confidence: 0.85,
  },
  {
    id: "postcode-uk",
    type: "ADDRESS",
    level: "strict",
    about: "UK postcodes (SW1A 1AA)",
    re: re(
      "(?<![\\p{L}\\p{N}_])(?:[A-PR-UWYZ](?:\\d[A-HJKPSTUW\\d]?|[A-HK-Y]\\d[ABEHMNPRV-Y\\d]?) \\d[ABD-HJLNP-UW-Z]{2})(?![\\p{L}\\p{N}_])",
    ),
    confidence: 0.8,
  },
  {
    id: "postcode-us",
    type: "ADDRESS",
    level: "strict",
    about: "US ZIP codes after a state code (NY 10001)",
    re: re(
      "(?<![\\p{L}\\p{N}_])(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)[ \\t]+(\\d{5}(?:-\\d{4})?)(?![\\p{L}\\p{N}_-])",
    ),
    group: 1,
    confidence: 0.8,
  },
];
