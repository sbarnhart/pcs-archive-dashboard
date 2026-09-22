import json
import openpyxl

source = r"C:\Users\steve\OneDrive\Desktop\StockMasterList (2).xlsx"
destination = r"tmp\stock-master-list.json"
sheet = openpyxl.load_workbook(source, read_only=True, data_only=True).active
sheet.reset_dimensions()  # The source file incorrectly declares its used range as A1.

def string(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()

rows = []
for excel_row, values in enumerate(sheet.iter_rows(values_only=True), start=1):
    if excel_row <= 4 or not string(values[1]):
        continue
    if string(values[0]).startswith("Printed On "):
        continue
    rows.append({
        "excel_row": excel_row,
        "product_code": string(values[0]),
        "description": string(values[1]),
        "category": string(values[2]),
        "type": string(values[3]),
        "ticket_value": values[4],
        "sale_price": values[5],
        "vending_price": values[6],
        "unit_name": string(values[7]),
        "barcodes": [v.strip() for v in string(values[8]).split(";") if v.strip()],
    })
with open(destination, "w", encoding="utf-8") as output:
    json.dump(rows, output, ensure_ascii=False)
print(f"Extracted {len(rows)} report rows to {destination}")
