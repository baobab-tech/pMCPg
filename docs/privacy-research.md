# Privacy detection research (2026-11)

Goal: detect PII and secrets in tool results and arguments on the CPU, from TypeScript on Bun, with no new runtime dependency. Tier 0 (patterns and checksums) ships now; tiers 1 and 2 (models) are later.

## Decision

- Tier 0 is plain regexes plus validators, written in `src/privacy/`. No runtime dependency added.
- Secret rules are vendored from gitleaks (MIT) as generated data. Our own rules add URL credentials and labelled passwords.
- Phone numbers use format heuristics instead of libphonenumber metadata.
- Names, organisations and addresses (strict) are masked only where a label or layout makes them reliable. Free-text names wait for a tier 1 model.
- Measured on an M-series Mac: 1 MB of mixed text masks in about 100 ms at either level; 20,000 short strings in about 160 ms.

## Secrets

| Source | Licence | Use |
|---|---|---|
| [gitleaks `config/gitleaks.toml`](https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml) | MIT | Vendored. 222 rules; 217 kept (5 are scoped to file paths). Converted by `src/privacy/secrets/gen-gitleaks.ts`; licence text in the generated file |
| [gitleaks scanning approach](https://lookingatcomputer.substack.com/p/regex-is-almost-all-you-need) | n/a | Keyword prefilter, then regex, then Shannon entropy, then allowlists and stopwords. Copied as is |
| [secretlint](https://github.com/secretlint/secretlint) | MIT | Not used. Smaller rule set than gitleaks |
| [Yelp detect-secrets](https://github.com/Yelp/detect-secrets) | Apache-2.0 | Not used. Its high-entropy-string plugins produce many false positives on prose |
| trufflehog | AGPL-3.0 | Not usable: copyleft. Already excluded in `research-2026-11.md` |

Go RE2 to JavaScript conversion:

- A leading `(?i)` becomes the `i` flag.
- A mid-pattern `(?i)` becomes a `(?i:...)` group up to the end of the current alternative. Bun (JavaScriptCore) supports regex modifiers.
- `(?-i:...)` groups pass through unchanged.
- `[[:alnum:]]` and other POSIX classes are expanded. `\z` becomes `$`.
- Every rule is compiled at generation time; rules that fail are dropped and listed.

## PII patterns and validators

| Type | Method | Reference |
|---|---|---|
| Card | Luhn, issuer prefix and length table (Visa, Mastercard incl. 2-series, Amex, Discover, JCB, Diners, UnionPay, Maestro, Mir) | [ISO/IEC 7812](https://en.wikipedia.org/wiki/Payment_card_number) |
| IBAN | Country length table and ISO 7064 mod 97 = 1 | SWIFT IBAN registry |
| Email | Unicode local part and domain, TLD of letters; rejects `logo@2x.png` | RFC 5322 (simplified) |
| Phone | `+` international (8 to 15 digits), NANP with separators, national trunk-0 with spaced groups, or any number after a phone label in 8 languages. Rejects dates, times, versions and numbers after "order", "invoice" and similar | ITU-T E.164 |
| IP | IPv4 octets 0-255, no leading zeros, not loopback, not after "version"/"v"; IPv6 group and compression rules, rejects clock times and MAC addresses | RFC 4291 |
| US SSN | Area not 000/666/9xx, group not 00, serial not 0000 | SSA randomization rules |
| Canada SIN | Luhn, first digit not 0 or 8 | ESDC |
| UK NINO | Prefix letter rules, excluded pairs (BG, GB, NK, KN, NT, TN, ZZ) | HMRC National Insurance manual |
| UK NHS | Mod 11; label required (3-3-4 layout looks like a phone number) | NHS Data Dictionary |
| India Aadhaar | 12 digits, first 2-9, Verhoeff checksum | UIDAI |
| India PAN | `AAAPA9999A` with holder-type letter | Income Tax Department |
| South Africa ID | YYMMDD date, citizenship digit, Luhn | python-stdnum za.idnr |
| Kenya | KRA PIN `[AP]` + 9 digits + letter; national ID (7-8 digits) and Huduma Namba only after a label | [KRA PIN guide](https://lookuptax.com/docs/tax-identification-number/kenya-tax-id-guide), [python-stdnum ke.pin](https://arthurdejong.org/python-stdnum/doc/stdnum.ke.pin) |
| Uganda NIN | `C[MF]` + 2 digits + 10 characters. NIRA publishes no check digit, so confidence is lower | [Smile ID](https://docs.usesmileid.com/supported-id-types/for-individuals-kyc/backed-by-id-authority/supported-countries/uganda/national-id-without-photo) |
| Ghana Card | `GHA-` + 9 digits + `-` + digit | NIA |
| Nigeria NIN, BVN | 11 digits, label required (no public checksum) | NIMC |
| Sweden | Personnummer, Luhn over 10 digits, coordination numbers (day + 60) | python-stdnum se.personnummer |
| Spain | DNI and NIE mod 23 letter | python-stdnum es.dni, es.nie |
| France | NIR 13 digits + key 97 - (n mod 97), Corsica 2A/2B | python-stdnum fr.nir |
| Belgium | National number mod 97, 2000+ births variant | python-stdnum be.nn |
| Italy | Codice fiscale check letter | python-stdnum it.codicefiscale |
| Poland | PESEL weighted checksum and encoded date; label required | python-stdnum pl.pesel |
| Germany | Steuer-IdNr ISO 7064 MOD 11,10; label required | python-stdnum de.idnr |
| Netherlands | BSN 11-proof; label required | python-stdnum nl.bsn |
| Brazil | CPF two mod 11 check digits | python-stdnum br.cpf |
| Mexico | CURP structure with state codes | RENAPO |

[python-stdnum](https://arthurdejong.org/python-stdnum/) is LGPL-2.1, so its code is not copied. Checksum algorithms are public facts; ours are written from the specifications and tested against published valid examples.

Rule: a format without a checksum, or one that collides with phone numbers or plain counters (9- and 11-digit IDs), needs a label such as "NIN:", "BSN", "Passport No.". Labels that name a non-personal ID ("Order ID number:") are rejected.

## Phone numbers without libphonenumber

- [libphonenumber-js](https://gitlab.com/catamphetamine/libphonenumber-js) (MIT) metadata is about 80 KB (min) to 145 KB (max). It validates numbers it is given; it does not find them in free text with good precision.
- Precision in free text depends more on context (dates, versions, order numbers) than on per-country numbering plans.
- Tier 0 uses format heuristics. Revisit if users report missed national formats; the min metadata could be vendored then.

## Names, organisations, addresses

Reliable without a model:

- labelled fields in 8 languages (`Name:`, `Nom :`, `Nombre:`, `Jina:`, `"first_name":`), with a reject list for `file name`, `project_name` and similar
- `Jane Doe <jane@...>`, honorifics (`Dr. Amina Wanjiru`), letter greetings and sign-offs
- legal suffixes (`Ltd`, `GmbH`, `Inc.`, `Foundation`)
- street patterns (English, French, Spanish, German), P.O. boxes (including Kenyan `12345-00100`), Canadian and UK postcodes, US ZIP after a state code

Not reliable without a model: names in running text ("I met Jane yesterday").

## Models for tiers 1 and 2 (not used yet)

| Model | Licence | Size | Notes |
|---|---|---|---|
| knowledgator GLiNER-PII | Apache-2.0 | about 197 MB int8 | Already noted in `research-2026-11.md` |
| [safetype/blackbar-nano](https://huggingface.co/safetype/blackbar-nano) | Apache-2.0 | about 300 MB fp16 (ModernBERT) | 35 PII types, English; card reports about 38 ms per message on an M1 CPU. Training data not released |
| [gravitee-io/gliner-pii-detection](https://huggingface.co/gravitee-io/gliner-pii-detection) | Apache-2.0 | small GLiNER, quantised ONNX | Candidate for tier 1 |
| [SemplificaAI/gliner2-privacy-filter-PII-multi](https://huggingface.co/SemplificaAI/gliner2-privacy-filter-PII-multi) | Apache-2.0 | about 590 MB fp16 | 42 types, 7 languages; tier 2 |
| [onnx-community/bert-small-pii-detection-ONNX](https://huggingface.co/onnx-community/bert-small-pii-detection-ONNX) | not stated | small | Check licence before use |
| piiranha | CC-BY-NC-ND | n/a | Not usable |
| [Microsoft Presidio](https://github.com/microsoft/presidio) | MIT | n/a | Python. Its recognizer patterns are a cross-check for country formats; most country recognizers ship disabled by default |

## Known limits

- Luhn-valid numbers that are not cards (10% of random numbers with a card prefix and length) are masked unless preceded by "order", "invoice", "ref" and similar.
- IPv4-shaped version strings are masked unless preceded by "v" or "version".
- Placeholders in structured content replace strings only; a client that validates `format: email` in an output schema may reject `[EMAIL_1]`. Numbers and booleans are never changed.
- A server can return text that looks like a placeholder (`[EMAIL_3]`). Re-hydration only restores placeholders the session created, so this cannot invent values, but it can point the model at a real one. Data-flow rules and approvals cover that path.
