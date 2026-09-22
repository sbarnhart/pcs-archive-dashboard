from pathlib import Path
from shutil import copy2, make_archive
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "output" / "kiosk-artwork"
OUT = SOURCE / "production-v11-background-only"
OUT.mkdir(parents=True, exist_ok=True)

ASSETS = [
    {
        "slug": "Lazertag-Extreme-Alpha-Header-v11-background-only",
        "tif": SOURCE / "Lazertag-Extreme-Alpha-Header-v11-background-only-CMYK.tif",
        "trim": (15.25, 4.375),
        "bleed": 0.125,
    },
    {
        "slug": "Lazertag-Extreme-Alpha-Door-v11-background-only",
        "tif": SOURCE / "Lazertag-Extreme-Alpha-Door-v11-background-only-CMYK.tif",
        "trim": (14.0, 6.0),
        "bleed": 0.125,
    },
]


def write_eps(image: Image.Image, output: Path, width_pt: float, height_pt: float):
    """Write a one-to-one EPS with an embedded CMYK raster image."""
    image = image.convert("CMYK")
    w, h = image.size
    bbox_w = int(round(width_pt))
    bbox_h = int(round(height_pt))
    header = (
        "%!PS-Adobe-3.0 EPSF-3.0\n"
        f"%%Title: {output.stem}\n"
        "%%Creator: Lazertag Extreme production artwork package\n"
        f"%%BoundingBox: 0 0 {bbox_w} {bbox_h}\n"
        f"%%HiResBoundingBox: 0 0 {width_pt:.4f} {height_pt:.4f}\n"
        "%%DocumentProcessColors: Cyan Magenta Yellow Black\n"
        "%%LanguageLevel: 2\n"
        "%%Pages: 1\n"
        "%%EndComments\n"
        "gsave\n"
        f"{width_pt:.4f} {height_pt:.4f} scale\n"
        f"{w} {h} 8 [{w} 0 0 -{h} 0 {h}]\n"
        "{currentfile /ASCIIHexDecode filter} false 4 colorimage\n"
    )
    raw = image.tobytes()
    with output.open("wb") as f:
        f.write(header.encode("ascii"))
        for start in range(0, len(raw), 48):
            f.write(raw[start:start + 48].hex().upper().encode("ascii") + b"\n")
        f.write(b">\ngrestore\nshowpage\n%%EOF\n")


def write_pdf(image: Image.Image, output: Path, width_pt: float, height_pt: float):
    """Write an exact-size PDF using a CMYK JPEG image stream."""
    jpeg = OUT / f".{output.stem}-embedded-cmyk.jpg"
    image.convert("CMYK").save(jpeg, "JPEG", quality=100, subsampling=0, dpi=(150, 150))
    c = canvas.Canvas(str(output), pagesize=(width_pt, height_pt), pageCompression=1)
    c.setTitle(output.stem)
    c.drawImage(ImageReader(str(jpeg)), 0, 0, width=width_pt, height=height_pt, preserveAspectRatio=False)
    c.showPage()
    c.save()
    jpeg.unlink()


manifest = [
    "LAZERTAG EXTREME - ALPHA KIOSK PRODUCTION PACKAGE",
    "",
    "Files are supplied one-to-one at final size with 0.125 inch bleed on every edge.",
    "Artwork contains no text or logo; no fonts are required.",
    "All TIFF raster assets are CMYK at 150 DPI and are embedded in the matching EPS/PDF files.",
    "Only the approved space-tech background and colored light accents remain.",
    "",
]

for asset in ASSETS:
    image = Image.open(asset["tif"])
    if image.mode != "CMYK":
        raise ValueError(f"{asset['tif'].name} is not CMYK: {image.mode}")
    dpi = image.info.get("dpi", (0, 0))
    if dpi[0] < 149 or dpi[1] < 149:
        raise ValueError(f"{asset['tif'].name} is below 150 DPI: {dpi}")
    page_inches = (asset["trim"][0] + 2 * asset["bleed"], asset["trim"][1] + 2 * asset["bleed"])
    width_pt, height_pt = page_inches[0] * 72, page_inches[1] * 72
    eps = OUT / f"{asset['slug']}-1to1-CMYK.eps"
    pdf = OUT / f"{asset['slug']}-1to1-CMYK.pdf"
    tif = OUT / f"{asset['slug']}-150dpi-CMYK.tif"
    write_eps(image, eps, width_pt, height_pt)
    write_pdf(image, pdf, width_pt, height_pt)
    copy2(asset["tif"], tif)

    reader = PdfReader(str(pdf))
    media = reader.pages[0].mediabox
    actual_pt = (float(media.width), float(media.height))
    expected_pt = (width_pt, height_pt)
    if any(abs(a - e) > 0.01 for a, e in zip(actual_pt, expected_pt)):
        raise ValueError(f"Incorrect PDF page size for {pdf.name}: {actual_pt}")
    xobjects = reader.pages[0]["/Resources"].get("/XObject", {})
    colorspaces = [str(obj.get_object().get("/ColorSpace")) for obj in xobjects.values()]
    if "/DeviceCMYK" not in colorspaces:
        raise ValueError(f"PDF image is not DeviceCMYK for {pdf.name}: {colorspaces}")

    manifest.extend([
        asset["slug"],
        f"  Trim: {asset['trim'][0]:g} x {asset['trim'][1]:g} inches",
        f"  Supplied page/art size with bleed: {page_inches[0]:g} x {page_inches[1]:g} inches",
        f"  Raster: {image.size[0]} x {image.size[1]} pixels, CMYK, 150 DPI",
        f"  PDF: {actual_pt[0] / 72:g} x {actual_pt[1] / 72:g} inches, embedded DeviceCMYK image",
        f"  EPS: one-to-one bounding box, embedded CMYK image",
        "",
    ])

(OUT / "PRODUCTION-NOTES.txt").write_text("\n".join(manifest), encoding="utf-8")

archive_base = SOURCE / "Lazertag-Extreme-Alpha-Kiosk-Production-v11-background-only"
zip_path = Path(make_archive(str(archive_base), "zip", root_dir=OUT))
print(OUT)
print(zip_path)
for item in sorted(OUT.iterdir()):
    print(item.name, item.stat().st_size)
