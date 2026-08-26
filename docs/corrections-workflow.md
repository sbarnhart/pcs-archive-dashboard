# Reporting exceptions and correction workflow

PCS remains the system of record. The export and reporting tools are read-only and never modify PCS.

## Data layers

1. **Raw snapshots** — immutable API/website responses, timestamped by extraction run.
2. **Current normalized data** — the newest successfully retrieved version of each record.
3. **Reporting overrides** — optional temporary annotations used only in reports; they never alter raw data.
4. **Issue queue** — records that need review or correction in PCS.

## Issue queue fields

- `issueId`
- `facilityId`
- `recordType` (order, item, customer, payment, product, user, etc.)
- `recordId`
- `orderNumber`
- `issueType`
- `description`
- `detectedAt`
- `sourceRunId`
- `sourceLastUpdated`
- `status` (`New`, `Reviewing`, `Waiting for PCS Fix`, `Ready to Resync`, `Verified`, `Won't Fix`)
- `priority`
- `assignedTo`
- `resolutionNotes`
- `overrideValue` and `overrideReason` when a temporary reporting treatment is approved
- `resolvedAt`
- `verifiedRunId`

## Workflow

1. A validation rule or user flags a record in the reporting Sheet.
2. The issue is added to the queue with the raw source run and PCS identifiers.
3. An authorized user reviews and, when appropriate, corrects the record in the PCS website.
4. The exporter re-pulls that specific record and all documented subresources.
5. The normalized current-data layer is refreshed from the new snapshot.
6. Validation rules run again.
7. The issue becomes `Verified` only when the new PCS data proves the correction.

## Important controls

- Google Sheets annotations must not silently replace raw PCS values.
- Every reporting override needs a reason, author, timestamp, and expiration/review date.
- Re-pulls append a new snapshot rather than overwriting historical raw files.
- Report totals should be available both as `PCS Current` and `Adjusted`, with the adjustment amount visible.

## Initial anomaly rules

- Event end date is in the past while the order remains open or pending review.
- Cancelled event still has payments, balance, or active party allocation.
- Cancelled event has no cancellation date.
- Fully paid order has a nonzero balance.
- Closed order has missing closeout/payment records.
- Order item references a missing product.
- Order has a `createdByUserId` that is absent from the user mapping.
- Event date, order date, or transaction date falls outside expected report allocation rules.

The power-outage cancellation is a useful validation case: preserve the original snapshot, flag the status/payment/date inconsistency, correct it in PCS if needed, re-pull the order, and retain both versions for auditability.
