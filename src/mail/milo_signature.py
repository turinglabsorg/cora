"""Signature cards rendered as images, so a tracked message reports its first open."""
import io
import re
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).resolve().parent / "signature_assets"
LOGOS = {}
SCALE = 2
LINK = re.compile(r"https?://\S+")
LINK_LABELS = {"linkedin.com": "LinkedIn", "x.com": "X", "twitter.com": "X", "github.com": "GitHub",
               "instagram.com": "Instagram", "facebook.com": "Facebook"}


def signature_parts(text):
    """Card lines and link lines of a signature: a line that is only a URL becomes a clickable link."""
    lines = [line.strip() for line in (text or "").strip().splitlines() if line.strip()]
    return [line for line in lines if not LINK.fullmatch(line)], [line for line in lines if LINK.fullmatch(line)]


def link_label(url):
    host = re.sub(r"^www\.", "", re.sub(r"^https?://", "", url).split("/")[0].split("?")[0].lower())
    return LINK_LABELS.get(host, host)


def logo_name(email):
    return None


@lru_cache(maxsize=64)
def render_signature(text, email="", avatar=None):
    """A white rounded card with the account logo and the signature lines: (png, width, height) at 1x."""
    lines = signature_parts(text)[0][:6] or [""]
    title = ImageFont.truetype(str(ASSETS / "Geist-SemiBold.ttf"), 15 * SCALE)
    body = ImageFont.truetype(str(ASSETS / "Geist-Regular.ttf"), 13 * SCALE)
    fonts = [title] + [body] * (len(lines) - 1)
    heights = [22 * SCALE] + [19 * SCALE] * (len(lines) - 1)
    pad, gap, logo_size = 14 * SCALE, 14 * SCALE, 44 * SCALE
    name = avatar
    measure = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    text_width = max(int(measure.textlength(line, font=font)) for line, font in zip(lines, fonts, strict=True))
    text_height = sum(heights)
    inner = max(text_height, logo_size if name else 0)
    left = pad + (logo_size + gap if name else 0)
    width, height = left + text_width + pad, inner + 2 * pad
    card = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle([0, 0, width - 1, height - 1], radius=12 * SCALE, fill="#ffffff",
                           outline="#e4e7ec", width=SCALE)
    if name:
        logo = Image.open(io.BytesIO(avatar)).convert("RGBA").resize((logo_size, logo_size), Image.LANCZOS)
        mask = Image.new("L", logo.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, logo_size - 1, logo_size - 1], radius=10 * SCALE, fill=255)
        logo.putalpha(Image.composite(logo.getchannel("A"), mask, mask))
        card.alpha_composite(logo, (pad, (height - logo_size) // 2))
    y = (height - text_height) // 2
    for line, font, line_height, color in zip(lines, fonts, heights, ["#172033"] + ["#617189"] * 5, strict=False):
        draw.text((left, y + line_height // 2), line, font=font, fill=color, anchor="lm")
        y += line_height
    output = io.BytesIO()
    card.save(output, "PNG", optimize=True)
    return output.getvalue(), width // SCALE, height // SCALE
