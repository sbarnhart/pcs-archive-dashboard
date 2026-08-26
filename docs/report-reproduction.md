# PCS report reproduction requirements

The export is considered complete only when the following PCS reports can be rebuilt and reconciled for the same facility and date range.

## Sales By Product (Cash Accounting)

Source: https://lazertagextreme.partycentersoftware.com/reports/sales_by_product_cash_accounting.asp

PCS definition observed in the live report:

- The search range applies to payments and refunds (transactions).
- An invoice is allocated to individual products only when its order date and every transaction date are inside the range and the invoice is fully paid.
- Event and online-booking orders use event date for the in-range test; POS and online-store orders use order date.
- Otherwise, the invoice is grouped as `Unallocated` instead of being split into product rows.
- Applied payment/tax allocation introduces rounding differences versus closeout totals.
- The report explicitly is not the authoritative tax-liability report.

Required archive data: orders, complete order items, products/categories, payments, refunds, transaction timestamps, order/event dates, balances, tax-exempt flags, item tax, discounts, and facility timezone.

## Revenue By Month

Source: https://lazertagextreme.partycentersoftware.com/reports/revenue_by_month.asp

PCS describes this as total payments taken month over month. Reproduction must group payment and refund transactions by facility-local transaction month, rather than order month or event month.

Required archive data: payment/refund amount, transaction timestamp, transaction type/status, order ID, facility ID, and facility timezone.

## Sales By Hour

Source: https://lazertagextreme.partycentersoftware.com/reports/sales_by_hour.asp

Observed behavior:

- Runs a seven-day period based on the selected start date.
- Supports configurable PCS product-tag sets.
- Includes a downloadable result.
- The page notes that it does not remove the newer discounts from totals.

Required archive data: order/item transaction timestamp at hour precision, item amount, quantity, product ID, product tag membership, discounts, order type, and facility timezone.

## Sales Analysis

Source: https://lazertagextreme.partycentersoftware.com/Leaf/reports/salesanalysis.aspx

Observed filters:

- Date range
- PCS product-tag set
- Order types: Event, POS, Online Booking, and Online Store
- Selected users or all users
- Output is a generated PDF

Required archive data: orders, items, products, categories, product tag membership, order type, user ID/name mapping, order/event/transaction dates, discounts, taxes, payments, and refunds.

## Website-only supplemental extracts

The documented API does not expose all report configuration. The read-only website collector should capture:

1. Product tag-set definitions and product membership.
2. User/employee ID-to-name mappings.
3. Report configuration metadata.
4. Reference report downloads for fixed validation periods.

Credentials and browser session data must never be stored in the archive or Git. Website collection must remain read-only.

## Reconciliation standard

For each report, retain a PCS-generated reference output and compare it with the reconstructed dataset for the identical facility, timezone, filters, and dates. Record row-level differences and totals. Rounding tolerances must be explicit; unexplained discrepancies are failures.
