# Working copies, 2026-09-14

Canonical release source: origin/main. Deploy only a clean, pushed main commit through scripts/deploy-vps.ps1. Do not use emergency provenance bypass for routine releases.

Desktop/bulkaiiko-bonus-system has been fast-forwarded to main. Previously modified and untracked files were preserved with git stash --include-untracked and durable local ref codex/preserved-desktop-20260914. The stash commit includes untracked files in its third parent. Nothing was discarded.

For recovery, create a separate checkout from the snapshot first parent, then apply the stash commit there. Do not apply it over current main: some changes are already integrated.

The AppData/Local/BULKA/iiko-invoices-deploy-20260913 release checkout must match origin/main. Check Git status and production release-version.json before deployment.

## Recommendations

BOUGHT_TOGETHER_BRANCHES_JSON maps each website branch UUID to {"serverId":"aktau-chain","departmentId":"iiko-department-uuid"}. Exact mappings select the department's 30-day iiko receipts. Unmapped branches use their own paid online orders, excluding cancellations and refunds. Do not infer branch identity from city or fuzzy names.

## Public image variants

Original menu_images objects remain untouched. /api/public/image accepts only paths in that public bucket and six fixed edge sizes. Sharp produces aspect-preserving WebP lossless variants; smaller original WebP files can be retained. Disk cache: seven-day lifetime, 512 MiB cleanup budget. HTTP: ETag and browser caching. Conversions are bounded and identical requests share a job. Clients fall back to originals on failure.
