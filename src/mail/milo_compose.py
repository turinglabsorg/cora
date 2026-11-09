"""Email composition adapted from turinglabsorg/milo; see LICENSE.milo."""
import base64
import json
import re
import sys
from html import escape
from milo_signature import render_signature, signature_parts, link_label

PIXEL_PATH = "/o/"
PIXEL_TOKEN = re.compile(r"[A-Za-z0-9_-]{24}")


def text_html(text):
    """Plain text as simple HTML paragraphs, for messages that need an HTML part."""
    blocks = re.split(r"\n{2,}", text or "")
    return "".join(f"<p>{escape(block).replace(chr(10), '<br>') or '<br>'}</p>" for block in blocks) or "<p><br></p>"


def html_with_pixel(html, url):
    """A 1x1 open-tracking image at the end of the HTML body."""
    image = f'<img src="{escape(url)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">'
    match = re.search(r"</body\s*>", html, re.I)
    return html[:match.start()] + image + html[match.start():] if match else html + image


def html_with_signature(html, signature, url, width, height):
    """Replace the composer's text signature with the tracked signature image, or append it.

    Complete HTML documents are templates with their own signature: they return None.
    """
    card, links = signature_parts(signature)
    image = (f'<img src="{escape(url)}" width="{width}" height="{height}" alt="{escape(" · ".join(card))}" '
             'style="display:block;border:0;border-radius:12px">')
    if links:
        image += ('<span style="display:block;margin:8px 0 0 4px;font:13px/18px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#617189">'
                  + " · ".join(f'<a href="{escape(link)}" style="color:#2f5bd3;text-decoration:none">{escape(link_label(link))}</a>'
                               for link in links) + "</span>")
    lines = [line.rstrip() for line in signature.strip().splitlines()]
    pattern = (r"<p>\s*--(?:\s|&nbsp;|\u00a0)*<br\s*/?>\s*"
               + r"\s*<br\s*/?>\s*".join(re.escape(escape(line, quote=False)) for line in lines)
               + r"\s*(?:<br\s*/?>\s*)?</p>")
    # No "-- " delimiter in HTML: Gmail folds everything after it like quoted text.
    block = f'<div style="margin:16px 0 0">{image}</div>'
    replaced, count = re.subn(pattern, lambda _: block, html, count=1)
    if count:
        return replaced
    if re.search(r"<html[\s>]", html, re.I):
        return None
    return html + block


request = json.load(sys.stdin)
signature = request.get("signature", "").strip()
avatar = base64.b64decode(request["avatar"]) if request.get("avatar") else None
png, width, height = render_signature(signature, request.get("email", ""), avatar)
html = request.get("html") or text_html(request.get("text", ""))
signed = html_with_signature(html, signature, request["image_url"], width, height) if signature else None
if signed is None:
    signed = html_with_pixel(html, request["pixel_url"]) if request.get("track") else html
plain = request.get("text", "")
if signature and signed != html and signature not in plain:
    plain += "\n\n-- \n" + signature
print(json.dumps({"html": signed, "text": plain, "png": base64.b64encode(png).decode(), "width": width, "height": height}))
