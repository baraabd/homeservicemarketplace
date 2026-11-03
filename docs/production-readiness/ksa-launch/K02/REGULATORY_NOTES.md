# K02 — Regulatory notes (engineering reading of official sources)

Fetched 2026-11-04. **Not legal advice.** Each item states what was verified
from the official page and what could not be verified. Unresolved legal
determinations are referred to the accountable owner (`OWNER_DECISIONS.md`).

## 1. Identity documents — PDPL Art. 28, Implementing Regulation Art. 31 (verified)

- Law Art. 28: official documents identifying the data subject may not be
  photographed or copied except to implement a statute or at the request of a
  competent public entity.
- IR Art. 31: repeats the prohibition; lawfully copied documents must be
  protected and destroyed as soon as the purpose ends unless a statute
  requires retention.
- Consent is not listed as an exception. Neither text names an alternative
  method; P-6's alternative is an engineering proposal.
- Sources: https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/PDPL ,
  https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/PDPL2

**Impact on this codebase:** the provider onboarding identity step (ADR 0009, 0010) collects and retains document images. K02 does not change it; O-10 must
decide the basis before production `VERIFICATION_ENFORCED=true`.

## 2. Data-subject rights (verified)

Law Art. 4 (inform, access, copy, correct, destroy), Art. 5(2) (withdraw
consent). IR Arts. 4–9, 12. IR Art. 3(1): respond within 30 days, extendable
by up to 30 days with prior notice and reasons; verify the requester's identity.

## 3. Cross-border transfer; register; DPO

- Verified: Law Art. 29; Transfer Regulation Arts. 2–4, 7 (adequacy list,
  safeguards such as SCCs, risk assessment).
  https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/RegulationonPersonalDataTransferOutsidetheKingdom
- Verified: IR Art. 32 (DPO required only in listed cases), IR Art. 34
  (national register rules issued by SDAIA).
- **Not verified:** the National Register of Controllers rules page returned
  "no content". Owner to confirm applicability (O-12).

## 4. Privacy notice content (verified)

Law Arts. 12–13; IR Art. 4(1): legal basis, purpose, mandatory/optional items,
controller identity and contacts, recipients and transfers outside KSA,
consequences of not providing data, retention, rights and how to exercise
them, how to withdraw consent. SDAIA guideline (non-binding) adds storage
location and change log. The K02 draft privacy page lists these headings and
marks undecided facts as pending.

## 5. E-Commerce Law and Implementing Regulation (Ministry of Commerce)

- Verified: Law (Royal Decree M/126, 1440H) Art. 6 — disclose name/mark,
  address, contact means, CR/register number; Art. 7 — pre-contract
  statement incl. total price with fees and taxes; Art. 8 invoice; Art. 9
  licensed-profession details.
  https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/360de590-0286-4fa5-a243-aa9100c31979/1
- Verified (decoded PDF, paraphrase — check the PDF before quoting):
  IR Art. 6 privacy policy, complaints, VAT number; IR Art. 18 for
  intermediary platforms — publish terms, rights, data protection,
  complaints and dispute policy; publish material changes ≥ 1 week ahead;
  keep provider identity/CR data; breach notice within 3 days; keep contract
  records ≥ 3 years. https://mc.gov.sa/ar/ECC/ECC_Docs/ERECS.pdf
- Not verified: current status of Maroof vs. business.sa authentication.

## 6. ZATCA e-invoicing (verified)

- Phase 1 (generation) applies to resident VAT taxpayers since 4 Dec 2021.
- Phase 2 (integration) is rolled out in waves by revenue; ZATCA notifies a
  taxpayer of its wave ≥ 6 months in advance; listed waves use 2022–2024
  revenue. A new entity is not in a listed wave until notified — **do not
  assume all startups are in the same phase.**
  https://zatca.gov.sa/en/E-Invoicing/Introduction/Pages/Roll-out-phases.aspx
- VAT registration: mandatory above SAR 375,000 annual revenue, voluntary
  above SAR 187,500. https://zatca.gov.sa/en/eServices/Pages/eservices-002.aspx

## 7. SAMA (verified text; applicability is an inference)

Law of Payments and Payment Services (M/26, 1443H) Art. 4 — providing payment
services requires a SAMA licence; Implementing Regulations (2023) list payment
aggregation and safeguarded funds. Collecting our own subscription fees through
a licensed PSP is the merchant role (inference, not stated text); holding or
passing on booking funds would approach licensable activity — hence P-1.
https://rulebook.sama.gov.sa/en/law-payments-and-payment-services

## 8. SaudiNIC (verified)

Saudi Domain Names Registration Regulations v5.0 (Feb 2024): eligibility
categories (cl. 4-1); `.com.sa` requires a valid CR or equivalent (cl. 4-3-2);
`.السعودية` open to any natural/legal person (cl. 4-2). https://nic.sa/en/help/regulation/
