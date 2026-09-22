from pathlib import Path
from collections import deque
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "kiosk-artwork"
ASSETS = OUT / "assets"
OUT.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)

HEADER_BG = ASSETS / "header-background-v6.png"
DOOR_BG = ASSETS / "door-background-v6.png"
LOGO = ASSETS / "LazertagLogo-from-AI-300dpi.png"


def font(size, bold=True):
    candidates = [
        Path(r"C:\Windows\Fonts\impact.ttf"),
        Path(r"C:\Windows\Fonts\arialbd.ttf") if bold else Path(r"C:\Windows\Fonts\arial.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def display_font(size):
    path = Path(r"D:\LTE\LTE - Marketing\Memberships\Fonts\Eurostile Extended #2 Bold.otf")
    if path.exists():
        return ImageFont.truetype(str(path), size=size)
    return font(size)


def logo_rgba(remove_white_outline=False):
    im = Image.open(LOGO).convert("RGBA")
    px = im.load()
    # Remove only near-white pixels connected to the image boundary. This keeps
    # the enclosed white fill of the word EXTREME intact.
    seen = set()
    queue = deque()
    for x in range(im.width):
        queue.extend(((x, 0), (x, im.height - 1)))
    for y in range(im.height):
        queue.extend(((0, y), (im.width - 1, y)))
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or x < 0 or y < 0 or x >= im.width or y >= im.height:
            continue
        seen.add((x, y))
        r, g, b, a = px[x, y]
        if min(r, g, b) < 225 or max(r, g, b) - min(r, g, b) > 18:
            continue
        px[x, y] = (r, g, b, 0)
        queue.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
    if remove_white_outline:
        # Remove the neutral white/silver extrusion around LAZERTAG while
        # preserving the white EXTREME lettering in the lower-right badge.
        for y in range(im.height):
            for x in range(im.width):
                # Preserve only the actual white EXTREME letter faces. The
                # broader silver/white bevel outside the red badge is removed.
                if (im.width * 0.64 < x < im.width * 0.955 and
                        im.height * 0.64 < y < im.height * 0.865):
                    continue
                r, g, b, a = px[x, y]
                if a and max(r, g, b) - min(r, g, b) < 26 and (r + g + b) / 3 > 105:
                    px[x, y] = (r, g, b, 0)
    return im


def fit_cover(im, size):
    scale = max(size[0] / im.width, size[1] / im.height)
    resized = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1])).convert("RGB")


def paste_center(base, overlay, center, max_size):
    scale = min(max_size[0] / overlay.width, max_size[1] / overlay.height)
    ov = overlay.resize((round(overlay.width * scale), round(overlay.height * scale)), Image.Resampling.LANCZOS)
    pos = (round(center[0] - ov.width / 2), round(center[1] - ov.height / 2))
    shadow = Image.new("RGBA", base.size)
    sh = Image.new("RGBA", ov.size, (0, 0, 0, 0))
    sh.putalpha(ov.getchannel("A").filter(ImageFilter.GaussianBlur(16)))
    shadow.alpha_composite(sh, (pos[0] + 10, pos[1] + 12))
    base.alpha_composite(shadow)
    base.alpha_composite(ov, pos)


def centered_text(draw, xy, text, typeface, fill, stroke=0, stroke_fill="black", spacing=4):
    box = draw.multiline_textbbox((0, 0), text, font=typeface, align="center", spacing=spacing, stroke_width=stroke)
    x = xy[0] - (box[2] - box[0]) / 2
    y = xy[1] - (box[3] - box[1]) / 2
    draw.multiline_text((x, y), text, font=typeface, fill=fill, align="center", spacing=spacing, stroke_width=stroke, stroke_fill=stroke_fill)


def build_header():
    # 15.25 x 4.375 viewable + 0.125 bleed on every edge at 150 dpi.
    dpi = 150
    bleed = 0.125
    trim = (15.25, 4.375)
    size = (round((trim[0] + 2 * bleed) * dpi), round((trim[1] + 2 * bleed) * dpi))
    base = fit_cover(Image.open(HEADER_BG), size).convert("RGBA")
    png = OUT / "Lazertag-Extreme-Alpha-Header-v11-background-only.png"
    base.convert("RGB").save(png, dpi=(dpi, dpi))
    base.convert("CMYK").save(OUT / "Lazertag-Extreme-Alpha-Header-v11-background-only-CMYK.tif", dpi=(dpi, dpi), compression="tiff_lzw")
    pdf = OUT / "Lazertag-Extreme-Alpha-Header-v11-background-only.pdf"
    c = canvas.Canvas(str(pdf), pagesize=((trim[0] + 2 * bleed) * 72, (trim[1] + 2 * bleed) * 72))
    c.drawImage(ImageReader(base.convert("RGB")), 0, 0, width=(trim[0] + 2 * bleed) * 72, height=(trim[1] + 2 * bleed) * 72)
    c.showPage(); c.save()
    return png, pdf


def build_door():
    # Recommended 14 x 6 art size + 0.125 bleed on every edge at 150 dpi.
    dpi = 150
    bleed = 0.125
    trim = (14, 6)
    size = (round((trim[0] + 2 * bleed) * dpi), round((trim[1] + 2 * bleed) * dpi))
    base = fit_cover(Image.open(DOOR_BG), size).convert("RGBA")
    png = OUT / "Lazertag-Extreme-Alpha-Door-v11-background-only.png"
    base.convert("RGB").save(png, dpi=(dpi, dpi))
    base.convert("CMYK").save(OUT / "Lazertag-Extreme-Alpha-Door-v11-background-only-CMYK.tif", dpi=(dpi, dpi), compression="tiff_lzw")
    pdf = OUT / "Lazertag-Extreme-Alpha-Door-v11-background-only.pdf"
    c = canvas.Canvas(str(pdf), pagesize=((trim[0] + 2 * bleed) * 72, (trim[1] + 2 * bleed) * 72))
    c.drawImage(ImageReader(base.convert("RGB")), 0, 0, width=(trim[0] + 2 * bleed) * 72, height=(trim[1] + 2 * bleed) * 72)
    c.showPage(); c.save()
    return png, pdf


if __name__ == "__main__":
    for p in (*build_header(), *build_door()):
        print(p)
