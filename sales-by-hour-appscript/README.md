# PCS Sales By Hour - Google Apps Script v1.0

Copy `SalesByHour.gs` and `appsscript.json` into a standalone Apps Script project attached to the destination Google Sheet.

Add these Script Properties:

- `PCS_FACILITY_ID`
- `PCS_COMPANY_ID`
- Optional: `PCS_API_BASE_URL` (defaults to `https://api.partycs.com`)
- Optional: `PCS_START_DATE` (defaults to `2013-01-01`)
- Optional: `PCS_END_DATE` (defaults to today)

Run in this order:

1. `setupSalesByHour`
2. `startSalesByHourBackfill`

The backfill pauses before the Apps Script runtime limit and schedules `runSalesByHourBatch` to continue automatically. Use the **PCS Sales By Hour** sheet menu to check status, stop the backfill, or rebuild the holiday views.
