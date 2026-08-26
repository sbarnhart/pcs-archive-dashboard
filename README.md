# PCS Full Export

Read-only, restartable export tooling for Party Center Software (PCS). The project exports raw API responses without changing PCS data and keeps credentials and export files out of Git.

## Safety model

- Only documented `GET` endpoints are allowed.
- Three documented report endpoints use `POST` to request report data; only those exact paths are allowed.
- No `PUT`, `PATCH`, or `DELETE` support exists.
- Every run writes a manifest and append-only JSONL data files.
- Secrets are read from environment variables, never from committed configuration.

## Quick start (PowerShell)

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env
# Fill in .env, then load those values into your environment.
pcs-export inventory
pcs-export export-all --start 2020-01-01 --end 2026-08-25
```

Use `pcs-export inventory` first. It verifies access and records facilities/company metadata without exporting the full dataset.

## Export coverage

- Company and facilities
- Customers
- Products
- Orders
- Per-order detail, customer, guests of honor, items, and party
- New and executed booking reports
- Closeout detail
- PC Pay funding and funding detail (when merchant identifiers are configured)

Output is written under `exports/<run timestamp>/`. The API's source JSON is preserved as JSONL so later database or dashboard transformations do not lose fields.

## Configuration

See `.env.example`. `PCS_FACILITY_ID` is the facility UUID used in the `pcs-facility-id` header. `PCS_COMPANY_ID` is sent in `pcs-company-id`. Multiple facilities can be supplied as a comma-separated list in `PCS_FACILITY_IDS`.

The earlier email-derived dataset is intentionally not an input to this project.

## Report compatibility

The archive is being designed to reproduce Sales By Product (Cash Accounting), Revenue By Month, Sales By Hour, and Sales Analysis. See `docs/report-reproduction.md` for the accounting rules, required fields, and website-only supplemental mappings.

Reporting exceptions and PCS correction verification are defined in `docs/corrections-workflow.md`.

## Dashboard

Build the current dashboard workbook from completed export manifests, order details, and validation issue queues:

```powershell
node scripts/build_dashboard.mjs
```

The generated workbook is written to `dashboard-output/PCS Archive Dashboard.xlsx`. It labels partial years explicitly and keeps order snapshot totals separate from PCS cash-accounting revenue until payment/refund transaction dates are available.

## Development

```powershell
pytest
ruff check .
```

The repository is ready to open as a VS Code workspace and publish to a new GitHub repository.
