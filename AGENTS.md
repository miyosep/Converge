# Converge agent instructions

Before planning or editing project code, read [docs/PRODUCT_RULES.md](docs/PRODUCT_RULES.md). Follow this mandatory product contract throughout implementation and review.

- Follow the owner's latest explicit decisions. When they change a product rule, update PRODUCT_RULES.md and affected behavior together.
- PRODUCT_RULES.md takes precedence over conflicting historical product descriptions in project_guideline.md, archived flows, examples and verification records. Preserve the technical specification's privacy, authentication and contract invariants.
- Current code is not proof of intended behavior. Identify all user paths affected by a rule and check them. Never substitute candidate browsing for one AI-selected proposal.
- Before reporting completion, use the acceptance checks in PRODUCT_RULES.md. State what was verified and what remains unverified; local tests are not evidence of production payments.
- Follow the checkout and deployment boundaries in PRODUCT_RULES.md. Preserve unrelated changes, active financial work, worker configuration and secrets.

## Payment setup UI: explicit prohibition

- NEVER show manual payment/deposit amount inputs, test-recipient wallet inputs, or a "Set payment terms" form in My plans, Discover, friend groups, or Explore demo. This rule applies to BOTH friends and demo, not just the demo welcome screen.
- Prepare terms from an authorized server configuration or verified quote. Do not invent a restaurant price, copy demo defaults into friends, or ask users to enter infrastructure values as a workaround.
- Show exact prepared amounts and test-payment status at wallet review; each real participant still approves separately. Removing configuration forms must not hide payment terms or imply consent.
- If the source of automatic terms has not been decided, clarify that source; do not silently restore the manual form. Check every affected path before completion.

## Preserve the approved My plans welcome

- The photo welcome card, Start a plan action and pointer interaction remain visible even when saved plans exist. Render saved plans below the card; never replace it with the list or hide it based on group count.
- Do not remove or replace approved visual elements while fixing unrelated behavior. Follow the owner's explicit design changes.
