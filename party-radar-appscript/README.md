# Party Radar v2.6

Standalone, API-only Google Apps Script project for Lazertag Extreme party operations.

This project creates a new spreadsheet named **Party Radar** inside the Party Tracker Drive folder. It does not modify the existing Party SMS Tracker, whose spreadsheet ID is explicitly blocked in `Code.gs`.

## Files

- `Code.gs` — event tracking, recommendations, Outbox, reports, dashboard, and setup.
- `PCS.gs` — required read-only PCS API synchronization.
- `appsscript.json` — Apps Script V8 runtime manifest.

## Install at script.google.com

1. Create a new standalone Apps Script project named **Party Radar**.
2. Replace the default `Code.gs` contents with this project's `Code.gs`.
3. Add a script file named `PCS` and paste `PCS.gs` into it.
4. Open Project Settings, enable **Show appsscript.json**, and replace its contents with this project's manifest.
5. Add the `MGMT_EMAILS` Script Property with one or more comma-separated management addresses.
6. Add `PCS_FACILITY_ID` with the 36-character facility credential UUID and `PCS_COMPANY_ID` with `636`.
7. Do not add `SS_ID`. The first `setup()` run creates the spreadsheet and saves its ID automatically.
8. Run `setup()` and approve the requested permissions. Setup creates or refreshes the Dashboard.
9. Run `discoverPCS()`, review the Run Log, then run `setupPCS()`.
10. Run `bootstrapUpcomingPCS()` once to discover older bookings in safe five-minute windows.
11. Open the **Party Radar** spreadsheet and reload it once to display the Party Radar menu. Use **Show Party Radar spreadsheet** in that menu whenever you need to verify the script's target file.

## Safety defaults

- `SENDING_ENABLED` starts as `FALSE`.
- `sendSMS_()` remains a stub; no SMS is sent.
- PCS integration is read-only and is the only ingestion path; Gmail is not authorized or accessed.
- The reference Party SMS Tracker spreadsheet is blocked by ID.

After setup, run `discoverPCS()` and `syncPCS()` manually once. Review `Dashboard`, `Run Log`, `Upcoming Events`, `Recommended Changes`, and `Outbox` before relying on the hourly trigger.
