# Archived example catalog

`catalog-archive.json` preserves the complete synthetic catalog found in this branch: **200 entries**, with 40 restaurants, 40 stays, 40 spaces, 40 sports options and 40 classes. No 400-entry catalog was present.

The default new-plan entry (`/group/new`) now redirects to `/discover`, where Qwen chooses a search tool and xAPI supplies real results for all five categories. The snapshot is not a source for live results or a fallback when search fails. For the hackathon, real results are assumed reservable with USDC without checking availability.

The fictional planning flow remains available explicitly at `/demo/catalog`. Source catalog modules remain in place for existing groups, deterministic tests and the payment demonstration; real search results do not represent enrolled payment merchants.
