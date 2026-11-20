import { describe, expect, test } from "bun:test";
import * as v from "../../src/privacy/validate.ts";

type Case = [string, boolean];
const table: [string, (s: string) => boolean, Case[]][] = [
  [
    "luhn",
    v.luhn,
    [
      ["79927398713", true],
      ["79927398710", false],
      ["0", true],
      ["abc", false],
    ],
  ],
  [
    "card",
    v.card,
    [
      ["4111111111111111", true],
      ["4111 1111 1111 1111", true],
      ["5555555555554444", true],
      ["2223003122003222", true],
      ["378282246310005", true],
      ["6011111111111117", true],
      ["3530111333300000", true],
      ["4111111111111112", false], // Luhn fails
      ["0000000000000000", false], // repeated digit
      ["9111111111111119", false], // unknown issuer
      ["411111111111", false], // too short
      ["37828224631000", false], // Amex length wrong
    ],
  ],
  [
    "iban",
    v.iban,
    [
      ["GB82WEST12345698765432", true],
      ["GB82 WEST 1234 5698 7654 32", true],
      ["DE89370400440532013000", true],
      ["FR1420041010050500013M02606", true],
      ["NL91ABNA0417164300", true],
      ["CH9300762011623852957", true],
      ["BE68539007547034", true],
      ["GB82WEST12345698765433", false], // checksum
      ["GB82WEST1234569876543", false], // length
      ["XX82WEST12345698765432", false], // unknown country
    ],
  ],
  [
    "ssn",
    v.ssn,
    [
      ["123-45-6789", true],
      ["000-12-3456", false],
      ["666-12-3456", false],
      ["912-12-3456", false],
      ["123-00-4567", false],
      ["123-45-0000", false],
    ],
  ],
  [
    "sin",
    v.sin,
    [
      ["130 692 544", true],
      ["273-849-158", true],
      ["130 692 545", false],
      ["046 454 286", false], // starts with 0
    ],
  ],
  [
    "nhs",
    v.nhs,
    [
      ["943 476 5919", true],
      ["943 476 5918", false],
    ],
  ],
  [
    "aadhaar",
    v.aadhaar,
    [
      ["2345 6789 0124", true],
      ["4918 3726 4503", true],
      ["2345 6789 0123", false],
      ["1234 5678 9012", false], // starts with 1
    ],
  ],
  [
    "zaId",
    v.zaId,
    [
      ["8001015009087", true],
      ["8001015009088", false],
      ["8013015009087", false], // month 13
    ],
  ],
  [
    "sePnr",
    v.sePnr,
    [
      ["811228-9874", true],
      ["19811228-9874", true],
      ["811228-9875", false],
    ],
  ],
  [
    "pesel",
    v.pesel,
    [
      ["44051401359", true],
      ["44051401358", false],
    ],
  ],
  [
    "esDni",
    v.esDni,
    [
      ["12345678Z", true],
      ["X1234567L", true],
      ["12345678A", false],
    ],
  ],
  [
    "frNir",
    v.frNir,
    [
      ["185057800608491", true],
      ["1 85 05 78 006 084 91", true],
      ["185057800608492", false],
    ],
  ],
  [
    "beNn",
    v.beNn,
    [
      ["85.07.30-033.28", true],
      ["85.07.30-033.29", false],
    ],
  ],
  [
    "itCf",
    v.itCf,
    [
      ["RSSMRA85T10A562S", true],
      ["RSSMRA85T10A562T", false],
    ],
  ],
  [
    "brCpf",
    v.brCpf,
    [
      ["529.982.247-25", true],
      ["529.982.247-26", false],
      ["111.111.111-11", false],
    ],
  ],
  [
    "deTaxId",
    v.deTaxId,
    [
      ["86095742719", true],
      ["86095742718", false],
    ],
  ],
  [
    "bsn",
    v.bsn,
    [
      ["111222333", true],
      ["111222334", false],
    ],
  ],
  [
    "ipv4",
    v.ipv4,
    [
      ["192.168.1.20", true],
      ["8.8.8.8", true],
      ["256.1.1.1", false],
      ["01.2.3.4", false],
      ["127.0.0.1", false],
      ["0.0.0.0", false],
      ["1.2.3", false],
    ],
  ],
  [
    "ipv6",
    v.ipv6,
    [
      ["2001:db8::1", true],
      ["fe80::1ff:fe23:4567:890a", true],
      ["2001:0db8:85a3:0000:0000:8a2e:0370:7334", true],
      ["::1", false],
      ["12:30:45", false],
      ["00:1A:2B:3C:4D:5E", false],
      ["1:2:3:4:5:6:7:8:9", false],
    ],
  ],
];

describe("validators", () => {
  for (const [name, fn, cases] of table) {
    test.each(cases)(`${name}(%p) is %p`, (input, expected) => {
      expect(fn(input)).toBe(expected);
    });
  }

  test("entropy", () => {
    expect(v.entropy("")).toBe(0);
    expect(v.entropy("aaaa")).toBe(0);
    expect(v.entropy("abcd")).toBe(2);
    expect(v.entropy("R7k2mQx9Lp4vT8nW3zY6")).toBeGreaterThan(4);
  });

  test("validDate", () => {
    expect(v.validDate(2, 29, 2024)).toBe(true);
    expect(v.validDate(2, 29, 2023)).toBe(false);
    expect(v.validDate(4, 31)).toBe(false);
    expect(v.validDate(13, 1)).toBe(false);
  });
});
