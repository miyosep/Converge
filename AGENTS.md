# Converge agent instructions

Before planning or editing project code, read [docs/PRODUCT_RULES.md](docs/PRODUCT_RULES.md). Follow this mandatory product contract throughout implementation and review.

- Follow the owner's latest explicit decisions. When they change a product rule, update PRODUCT_RULES.md and affected behavior together.
- PRODUCT_RULES.md takes precedence over conflicting historical product descriptions in project_guideline.md, archived flows, examples and verification records. Preserve the technical specification's privacy, authentication and contract invariants.
- Current code is not proof of intended behavior. Identify all user paths affected by a rule and check them. Never substitute candidate browsing for one AI-selected proposal.
- Before reporting completion, use the acceptance checks in PRODUCT_RULES.md. State what was verified and what remains unverified; local tests are not evidence of production payments.
- Follow the checkout and deployment boundaries in PRODUCT_RULES.md. Preserve unrelated changes, active financial work, worker configuration and secrets.

## Payment setup UI: explicit prohibition

- NEVER show manual payment/deposit amount inputs, test-recipient wallet inputs, or a "Set payment terms" form in My plans, Discover, friend groups, or Explore demo. This rule applies to BOTH friends and demo, not just the demo welcome screen.
- Derive the My plans payment amount from the selected restaurant's supported price/quote or the participants' confirmed budgets; server configuration supplies the test recipient, not an arbitrary fixed amount. Do not invent a restaurant price, copy demo defaults into friends, or ask users to enter infrastructure values as a workaround.
- Show exact prepared amounts and test-payment status at wallet review; each real participant still approves separately. Removing configuration forms must not hide payment terms or imply consent.
- If the source of automatic terms has not been decided, clarify that source; do not silently restore the manual form. Check every affected path before completion.

## Preserve the approved My plans welcome

- The photo welcome card, Start a plan action and pointer interaction remain visible even when saved plans exist. Render saved plans below the card; never replace it with the list or hide it based on group count.
- Do not remove or replace approved visual elements while fixing unrelated behavior. Follow the owner's explicit design changes.

## My plans payment amount: no fixed default

- NEVER use a fixed 10 MockUSDC per person, a fixed group total, or a demo amount as the My plans payment basis. The selected restaurant's supported price/quote or the participants' confirmed budgets must determine it.
- Preserve the source, currency and per-person/group unit. A price range is not an exact payable quote, and a meal budget is not automatically a reservation deposit. Do not invent a price, exchange rate, deposit percentage or an amount when data is missing.
- Show the calculated total, individual share and whether it is a price-based estimate or budget-based test payment before wallet approval. Each participant still approves separately.
- Keep manual amount/recipient setup forms removed. Existing signed policies remain immutable; new calculation rules apply to new decisions. Collect only a PARTIAL reservation deposit derived from the supported restaurant price or confirmed budget, never the full meal price/budget. The owner confirmed a 30% deposit. Collect exactly 30% of the supported price/budget basis, subject only to token precision rounding. Never automatically collect the remaining 70%.
