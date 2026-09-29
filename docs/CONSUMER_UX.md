# Consumer experience

Converge helps a group choose a shared outing and review each person's costs.
The interface leads with the outing, people, preferences and amounts.

## Visual direction

- Warm ivory canvas, charcoal text, muted brick red actions, sage status panels.
- Lifestyle photography, generous spacing and readable system typography.
- One main action per step; visible keyboard focus and responsive layouts.
- No invented social proof, live activity, ratings or booking guarantees.

The hero now leads with centered benefit copy and a start action over a softly
washed sky-and-city photograph. It fills the initial viewport, with a scroll
link to the interactive product example directly below it.
Visitors can switch between dinner, a weekend stay and a class, then explore
private preferences, an illustrative recommendation, a four-way deposit split
and collective approval. It does not submit preferences or simulate real
approvals. Lifestyle photography supports the closing section. The examples
are illustrative amounts, not live catalog quotes or engine results.

### Sky background

Asset: `public/images/converge-city-sky.webp`. Created with the built-in image
generation tool and encoded as WebP. Decorative, with empty alt text; foreground
copy and buttons retain full opacity. No reference-site artwork was copied.

Prompt: "Use case: photorealistic-natural. Asset type: full-bleed website hero
background for a friendly consumer group-planning service. Wide panoramic 16:9
editorial cityscape photograph viewed from a rooftop above a welcoming walkable
city, low-rise cream and terracotta apartment buildings, occasional leafy trees,
distant gentle urban skyline. Huge open powder-blue sky occupies upper 72 percent
of image, with soft wispy and cotton clouds at the far edges; the central upper
and middle sky remains clean, very pale and uncluttered for large dark typography
to be composited later. City occupies bottom 28 percent only, warm afternoon
sunlight, subtle atmospheric haze, quiet optimistic weekend feeling. Muted warm
ivory, dusty blue, sage green and tiny terracotta accents, natural photographic
texture with very subtle film grain, sophisticated approachable lifestyle brand.
No dominant landmark, no futuristic towers, no people close-up, no lettering, no
text, no logos, no balloons, no UI. Buildings detailed and believable but
subordinate to the spacious sky. Output high quality landscape background."

## Journey

1. The signed-out introduction explains the benefit and offers a demo.
2. Start a plan opens a native modal explaining MetaMask sign-in. Only verified
   authentication reveals the workspace. Existing invitations remain attached.
3. The basics collect category, name, date and group size. A future date is required.
4. The second step shows the shortlist. Back preserves details and selection;
   changing category resets the shortlist to that category's examples.
5. Private preferences are reviewed before confirmation. Recommendations use the
   same existing evaluation and privacy rules.
6. The payment screen puts the per-person deposit first. Contract identities remain
   available in disclosure sections. Registration, allowance and contribution are
   still distinct wallet actions. Test-token and no-real-booking labels stay visible.

## Verification

Browser checks covered sign-in modal keyboard opening, Escape and focus restoration;
category selection, step transitions and heading focus; preservation of fields and
empty selections across Back/Next; blocking creation with no candidates; mobile
layout with no horizontal overflow. The builder was tested through a temporary
local UI fixture, removed afterward. No real wallet signature or payment was made.

## Image provenance

Asset: `public/images/converge-together.webp`, generated with the built-in image
generation tool, then encoded as WebP. This is illustrative photography, not a
customer testimonial or an actual venue.

Prompt: "Use case: photorealistic-natural. Asset type: consumer group-planning
website hero image. Candid editorial lifestyle photograph of five adult friends
of mixed backgrounds laughing together around a small wooden table on a sunny
leafy courtyard terrace, sharing coffee and simple snacks while discussing a
weekend outing. Warm natural sunlight, cream linen, terracotta ceramics, sage
greenery, relaxed authentic body language, subtle film grain. Stylish but
approachable, everyday friends rather than luxury advertising. Landscape 3:2
framing with all faces in central area for responsive crops. No words, no logos,
no UI overlays, no watermark. Natural anatomy and hands."
