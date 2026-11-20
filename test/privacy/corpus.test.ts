// Table-driven corpus: each row is text, level, and exactly what must be found ("TYPE:value").
import { describe, expect, test } from "bun:test";
import type { PrivacyLevel } from "../../src/core/config.ts";
import { found } from "./helpers.ts";

type Row = [label: string, text: string, expected: string[]];

const STANDARD: Record<string, Row[]> = {
  email: [
    ["plain", "Write to jane.doe@acme.com today", ["EMAIL:jane.doe@acme.com"]],
    ["plus tag and subdomain", "a+b@mail.ngo.org.uk.", ["EMAIL:a+b@mail.ngo.org.uk"]],
    ["in angle brackets", "<info@example.org>", ["EMAIL:info@example.org"]],
    ["unicode local part", "Écrivez à josé.garcía@correo.es", ["EMAIL:josé.garcía@correo.es"]],
    ["in JSON", '{"email":"k.otieno@shirika.or.ke"}', ["EMAIL:k.otieno@shirika.or.ke"]],
    ["retina image is not an email", "logo@2x.png and icon@3x.webp", []],
    ["no TLD", "user@localhost", []],
    ["malformed but still masked", "a..b@example.com", ["EMAIL:a..b@example.com"]],
    ["npm scope is not an email", "install @types/node", []],
  ],
  phone: [
    ["E.164", "Call +14165550142 now", ["PHONE:+14165550142"]],
    ["international spaced", "Phone +44 20 7946 0958.", ["PHONE:+44 20 7946 0958"]],
    ["Kenya intl", "Simu: +254 712 345 678", ["PHONE:+254 712 345 678"]],
    ["NANP parens", "(613) 555-0142", ["PHONE:(613) 555-0142"]],
    ["NANP dashes", "call 613-555-0142 or 613.555.0199", ["PHONE:613-555-0142", "PHONE:613.555.0199"]],
    ["UK national", "Ring 020 7946 0958 please", ["PHONE:020 7946 0958"]],
    ["Kenya national", "Mpigie 0712 345 678 kesho", ["PHONE:0712 345 678"]],
    ["France national", "Appelez le 06 12 34 56 78", ["PHONE:06 12 34 56 78"]],
    ["labelled", "Tel: 7946 0958 123", ["PHONE:7946 0958 123"]],
    ["labelled Spanish", "Teléfono: 912 345 678", ["PHONE:912 345 678"]],
    ["ISO date", "Due 2024-11-07", []],
    ["date with spaces", "Meeting 07 11 2026 14:30", []],
    ["clock time", "at 12:30:45 UTC", []],
    ["order number", "Order 613-555-0142 shipped", []],
    ["version", "release 10.2.3", []],
    ["short number", "Room 101, floor 3", []],
    ["year range", "2019-2024 strategy", []],
  ],
  card: [
    ["Visa contiguous", "Card 4111111111111111 expires", ["CARD:4111111111111111"]],
    ["Visa grouped", "4111 1111 1111 1111", ["CARD:4111 1111 1111 1111"]],
    ["Mastercard dashed", "5555-5555-5555-4444", ["CARD:5555-5555-5555-4444"]],
    ["Amex 4-6-5", "3782 822463 10005", ["CARD:3782 822463 10005"]],
    ["Luhn fails", "4111111111111112", []],
    ["order number", "Order #4111111111111111", []],
    ["invoice number", "Invoice no. 5555555555554444", []],
    ["unknown issuer", "9111111111111119", []],
    ["timestamp in ms", "ts 1730937600000", []],
  ],
  iban: [
    ["UK grouped", "Pay GB82 WEST 1234 5698 7654 32 today", ["IBAN:GB82 WEST 1234 5698 7654 32"]],
    ["DE compact", "IBAN DE89370400440532013000", ["IBAN:DE89370400440532013000"]],
    ["FR with letter", "FR1420041010050500013M02606", ["IBAN:FR1420041010050500013M02606"]],
    ["checksum fails", "GB82WEST12345698765433", []],
    ["product code", "SKU AB12CDEF3456", []],
  ],
  ip: [
    ["IPv4", "Server 192.168.1.20, ok", ["IP:192.168.1.20"]],
    ["public IPv4", "from 8.8.8.8:53", ["IP:8.8.8.8"]],
    ["IPv6 compressed", "addr 2001:db8::1 up", ["IP:2001:db8::1"]],
    ["IPv6 full", "2001:0db8:85a3:0000:0000:8a2e:0370:7334", ["IP:2001:0db8:85a3:0000:0000:8a2e:0370:7334"]],
    ["version string", "version 1.2.3.4", []],
    ["v-prefixed", "v10.0.0.1", []],
    ["five parts", "OID 1.3.6.1.4.1", []],
    ["out of range", "999.1.1.1", []],
    ["loopback", "127.0.0.1", []],
    ["MAC address", "MAC 00:1A:2B:3C:4D:5E", []],
    ["C++ scope", "std::vector and a::b", []],
  ],
  nationalId: [
    ["US SSN", "SSN 123-45-6789", ["NATIONAL_ID:123-45-6789"]],
    ["US SSN labelled compact", "SSN: 123456789", ["NATIONAL_ID:123456789"]],
    ["SSN invalid area", "000-12-3456", []],
    ["Canadian SIN", "SIN 130 692 544", ["NATIONAL_ID:130 692 544"]],
    ["Canadian NAS labelled", "NAS : 273849158", ["NATIONAL_ID:273849158"]],
    ["SIN Luhn fails", "130 692 545", []],
    ["UK NINO", "NI number AB 12 34 56 C", ["NATIONAL_ID:AB 12 34 56 C"]],
    ["UK NINO invalid prefix", "GB 12 34 56 C", []],
    ["UK NHS labelled", "NHS number: 943 476 5919", ["NATIONAL_ID:943 476 5919"]],
    ["Aadhaar", "Aadhaar 2345 6789 0124", ["NATIONAL_ID:2345 6789 0124"]],
    ["Indian PAN", "PAN ABCPE1234F", ["NATIONAL_ID:ABCPE1234F"]],
    ["South African ID", "ID 8001015009087", ["NATIONAL_ID:8001015009087"]],
    ["Kenya KRA PIN", "KRA PIN A123456789Z", ["NATIONAL_ID:A123456789Z"]],
    ["Kenya national ID labelled", "National ID No: 23456789", ["NATIONAL_ID:23456789"]],
    ["Huduma Namba", "Huduma Namba: 12345678", ["NATIONAL_ID:12345678"]],
    ["Ghana Card", "GHA-123456789-0", ["NATIONAL_ID:GHA-123456789-0"]],
    ["Uganda NIN", "NIN CM9001234567AB", ["NATIONAL_ID:CM9001234567AB"]],
    ["Nigeria NIN labelled", "NIN: 12345678901", ["NATIONAL_ID:12345678901"]],
    ["passport labelled", "Passport No. X1234567", ["NATIONAL_ID:X1234567"]],
    ["Swedish personnummer", "811228-9874", ["NATIONAL_ID:811228-9874"]],
    ["Spanish DNI", "DNI 12345678Z", ["NATIONAL_ID:12345678Z"]],
    ["Spanish NIE", "NIE X1234567L", ["NATIONAL_ID:X1234567L"]],
    ["French NIR", "n° sécu 1 85 05 78 006 084 91", ["NATIONAL_ID:1 85 05 78 006 084 91"]],
    ["Belgian NN", "85.07.30-033.28", ["NATIONAL_ID:85.07.30-033.28"]],
    ["Italian CF", "CF RSSMRA85T10A562S", ["NATIONAL_ID:RSSMRA85T10A562S"]],
    ["Polish PESEL", "PESEL: 44051401359", ["NATIONAL_ID:44051401359"]],
    ["German tax ID", "Steuer-IdNr. 86 095 742 719", ["NATIONAL_ID:86 095 742 719"]],
    ["Dutch BSN", "BSN 111222333", ["NATIONAL_ID:111222333"]],
    ["Brazilian CPF", "CPF 529.982.247-25", ["NATIONAL_ID:529.982.247-25"]],
    ["Mexican CURP", "CURP GODE561231HDFRRN09", ["NATIONAL_ID:GODE561231HDFRRN09"]],
    ["order ID is not personal", "Order ID number: 12345678", []],
    ["customer ID is not personal", "Customer ID no 98765432", []],
    ["bare 9 digits", "ref 123456789", []],
    ["Spanish DNI wrong letter", "12345678A", []],
    ["git SHA", "commit 5f6ec56cfa6f8c67648d863582c7ae2f206d5c1c", []],
    ["UUID", "id 014df517-39d1-4453-b7b3-9930c563627c", []],
  ],
};

const STRICT: Record<string, Row[]> = {
  person: [
    ["labelled", "Name: Jane Doe\nAge: 34", ["PERSON:Jane Doe"]],
    ["labelled French", "Nom : Marie-Claire Dubois", ["PERSON:Marie-Claire Dubois"]],
    ["labelled Spanish", "Nombre: José García López", ["PERSON:José García López"]],
    ["labelled Swahili", "Jina: Wanjiku Kamau", ["PERSON:Wanjiku Kamau"]],
    ["JSON field", '{"first_name": "Amina", "last_name": "Odhiambo"}', ["PERSON:Amina", "PERSON:Odhiambo"]],
    ["particles", "Full name: Ludwig van Beethoven", ["PERSON:Ludwig van Beethoven"]],
    ["before email", "From: Jane Doe <jane@acme.com>", ["PERSON:Jane Doe", "EMAIL:jane@acme.com"]],
    ["honorific", "Dr. Amina Wanjiru will attend", ["PERSON:Amina Wanjiru"]],
    ["greeting", "Dear John Smith,\nThanks", ["PERSON:John Smith"]],
    ["sign-off", "Best regards,\nFatima Hassan\n", ["PERSON:Fatima Hassan"]],
    ["generic greeting", "Dear Sir/Madam,", []],
    ["greeting to team", "Dear Team,", []],
    ["file name label", "File name: Budget Report", []],
    ["project name JSON", '{"project_name": "Clean Water"}', []],
    ["lowercase value", "name: test", []],
    ["free-text name is left to models", "I met Jane Doe yesterday", []],
  ],
  org: [
    ["suffix", "Signed with Acme Widgets Ltd. today", ["ORG:Acme Widgets Ltd."]],
    ["GmbH", "Beispiel GmbH", ["ORG:Beispiel GmbH"]],
    ["labelled", "Organisation: Save the Children", ["ORG:Save the Children"]],
    ["labelled Spanish", "Empresa: Agua Limpia", ["ORG:Agua Limpia"]],
    ["no suffix", "We use Slack and Notion", []],
  ],
  address: [
    ["US street", "Ship to 1600 Pennsylvania Avenue now", ["ADDRESS:1600 Pennsylvania Avenue"]],
    [
      "UK street and postcode",
      "221B Baker Street, London NW1 6XE",
      ["ADDRESS:221B Baker Street", "ADDRESS:NW1 6XE"],
    ],
    ["French street", "au 12 rue de la Paix", ["ADDRESS:12 rue de la Paix"]],
    ["German street", "Hauptstraße 5, Berlin", ["ADDRESS:Hauptstraße 5"]],
    ["Spanish street", "Calle Mayor 5", ["ADDRESS:Calle Mayor 5"]],
    ["Kenyan PO box", "P.O. Box 12345-00100 Nairobi", ["ADDRESS:P.O. Box 12345-00100"]],
    ["Canadian postcode", "Ottawa ON K1A 0B1", ["ADDRESS:K1A 0B1"]],
    ["US ZIP after state", "New York, NY 10001", ["ADDRESS:10001"]],
    ["labelled", "Address: 45 Kenyatta Avenue, Nairobi", ["ADDRESS:45 Kenyatta Avenue, Nairobi"]],
    ["bare ZIP", "code 10001", []],
    ["quantity and noun", "5 Big Ideas", []],
  ],
};

async function check(level: PrivacyLevel, rows: Row[]) {
  const got: Record<string, string[]> = {};
  const want: Record<string, string[]> = {};
  for (const [label, text, expected] of rows) {
    got[label] = await found(text, level);
    want[label] = expected;
  }
  expect(got).toEqual(want);
}

describe("standard corpus", () => {
  for (const [type, rows] of Object.entries(STANDARD)) test(type, () => check("standard", rows));
});

describe("strict corpus", () => {
  for (const [type, rows] of Object.entries(STRICT)) test(type, () => check("strict", rows));

  test("standard does not mask names, organisations or addresses", async () => {
    const all = Object.values(STRICT).flat();
    for (const [, text] of all) {
      for (const f of await found(text, "standard")) expect(f).not.toMatch(/^(PERSON|ORG|ADDRESS):/);
    }
  });
});

describe("levels", () => {
  test("off finds secrets only", async () => {
    expect(await found("jane@acme.com ghp_R7k2mQx9Lp4vT8nW3zY6bH1cF5jD0sAeGuIo", "off")).toEqual([
      "SECRET:ghp_R7k2mQx9Lp4vT8nW3zY6bH1cF5jD0sAeGuIo",
    ]);
  });

  test("overlaps resolve to one span", async () => {
    // NHS label wins over the phone-shaped 3-3-4 pattern.
    expect(await found("NHS number: 943 476 5919")).toEqual(["NATIONAL_ID:943 476 5919"]);
  });
});

describe("multilingual documents", () => {
  test("French", async () => {
    const text =
      "Bonjour, je suis joignable au 06 12 34 56 78 ou par courriel à marie.dupont@exemple.fr. Mon numéro de sécurité sociale est 1 85 05 78 006 084 91.";
    expect(await found(text)).toEqual([
      "PHONE:06 12 34 56 78",
      "EMAIL:marie.dupont@exemple.fr",
      "NATIONAL_ID:1 85 05 78 006 084 91",
    ]);
  });

  test("Spanish", async () => {
    const text = "Mi DNI es 12345678Z y mi IBAN es ES91 2100 0418 4502 0005 1332. Teléfono: +34 912 345 678.";
    expect(await found(text)).toEqual([
      "NATIONAL_ID:12345678Z",
      "IBAN:ES91 2100 0418 4502 0005 1332",
      "PHONE:+34 912 345 678",
    ]);
  });

  test("Swahili", async () => {
    const text =
      "Habari, nambari yangu ya simu ni +254 712 345 678 na barua pepe ni wanjiku@shirika.or.ke. KRA PIN: A123456789Z.";
    expect(await found(text)).toEqual([
      "PHONE:+254 712 345 678",
      "EMAIL:wanjiku@shirika.or.ke",
      "NATIONAL_ID:A123456789Z",
    ]);
  });

  test("German", async () => {
    const text =
      "Name: Hans Müller\nAnschrift: Hauptstraße 5, 10115 Berlin\nTelefon: 030 1234 5678\nIBAN: DE89 3704 0044 0532 0130 00";
    expect(await found(text, "strict")).toEqual([
      "PERSON:Hans Müller",
      "ADDRESS:Hauptstraße 5, 10115 Berlin",
      "PHONE:030 1234 5678",
      "IBAN:DE89 3704 0044 0532 0130 00",
    ]);
  });

  test("Portuguese", async () => {
    const text = "Nome do cliente com CPF 529.982.247-25, celular: +55 11 91234 5678";
    expect(await found(text)).toEqual(["NATIONAL_ID:529.982.247-25", "PHONE:+55 11 91234 5678"]);
  });
});
