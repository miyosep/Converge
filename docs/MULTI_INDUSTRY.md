# Multi-industry sample catalog

Ordinary groups choose from five categories with 20 fictional examples each:
restaurants, stays, spaces, sports and classes. `/group/new` shows the project introduction until wallet sign-in succeeds.
Planning, searching and shortlisting become available after the server verifies
the wallet login signature. Search matches names, types, areas and facility labels.
Changing category resets the shortlist and search. Each group uses one category.

New inventory includes cabins and guesthouses, meeting rooms and studios,
futsal pitches and tennis courts, pottery and cooking workshops. Every venue,
price, capacity, amenity and availability claim is synthetic. No real booking is
made. The Explore Demo retains its original restaurant catalog and evidence.

## Price and condition semantics

Prices are fixed per-person estimates: per meal for restaurants, per night for
stays, per two hours for spaces, per hour for sports, and per session for classes.
The group deposit is separate and denominated in MockUSDC. Existing contribution
and spending caps apply. Deposits are credited toward the estimated service cost;
the remaining balance is outside the application payment flow.

New structured requirements cover minimum beds and affirmative facility support:
parking, Wi-Fi, pets, private space, projector, indoor facilities, equipment rental
and beginner suitability. Candidate capacity is checked against actual group size.
Missing bed, facility, dietary or accessibility information never counts as support.
Each facility is checked independently. Existing budget, distance, slot and soft
preferences continue to apply. Explicit unsupported requirements, including custom
durations, particular room types or activity subjects, require clarification;
users can shortlist the desired activity type directly.

## Compatibility and persistence

Apply `0011_multi_industry_catalog.sql` with `pnpm db:migrate:dev` before saving
new categories on the development branch. The migration extends the existing
shortlist check without rewriting any group or frozen snapshot. It rejects mixed
categories. The application also checks uniqueness and candidate identities.
Category is derived from immutable saved candidate IDs, rather than a separate
client-controlled category field. Group summaries expose that category.

The existing `permittedRestaurantIds`, `restaurants`, `mealPricePerPersonCents`
and `depositCreditedToMeal` storage names remain for compatibility. New candidates
add category, price unit, capacity, beds and facilities. New catalogs are versioned
`venues-v1`; the ordinary restaurant catalog remains `restaurants-v3`. Kiln
extraction uses `extraction-v2` and category-specific unit context. Additive
constraint fields retain schema version 1 so previous saved preferences remain
readable. The public explanation prompt is `public-explanation-v5`.

New merchant addresses are deterministic, receipt-only synthetic addresses, like
the existing expanded restaurant catalog. They do not identify real providers.
No contract, policy encoding, participant approval, or refund rule changes.

## Verification

`pnpm check` covers catalog isolation, feature requirements, capacity, unknown
metadata, exact policy binding, public units and extraction context. `pnpm build`
checks the application build. For persisted development-branch verification:

```sh
node --env-file=.env.development --import tsx scripts/multi-industry-rehearsal.ts
```

This rehearsal creates temporary two-member groups for all four new categories,
saves and confirms synthetic preferences, evaluates and freezes recommendations,
prepares v2 policies, reads them as another member, and removes its own records.
It makes no Kiln requests or chain transactions.
