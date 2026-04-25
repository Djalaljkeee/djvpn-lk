"""SHM captcha helpers: sniff/decoding."""

import base64

from captcha import decode_base64_image, extract_image_from_json, sniff_image_mime


SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text>x</text></svg>'
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPG = b"\xff\xd8\xff\xe0\x00" + b"\x00" * 16


def test_sniff_detects_svg_png_jpeg():
    assert sniff_image_mime(SVG) == "image/svg+xml"
    assert sniff_image_mime(b'<?xml version="1.0"?><svg>...</svg>') == "image/svg+xml"
    assert sniff_image_mime(PNG) == "image/png"
    assert sniff_image_mime(JPG) == "image/jpeg"
    assert sniff_image_mime(b"") is None
    assert sniff_image_mime(b"not an image") is None


def test_decode_base64_image_handles_padding_and_url_safe():
    b64 = base64.b64encode(SVG).decode()
    assert decode_base64_image(b64) == SVG
    assert decode_base64_image(b64.rstrip("=")) == SVG  # missing padding
    assert decode_base64_image(f"data:image/svg+xml;base64,{b64}") == SVG
    url_safe = base64.urlsafe_b64encode(SVG).decode().rstrip("=")
    assert decode_base64_image(url_safe) == SVG
    assert decode_base64_image("") is None


def test_extract_image_round_trips_svg_without_mime():
    """SHM возвращает SVG без явного content_type — sniff должен это вытащить."""
    payload = {"image": base64.b64encode(SVG).decode(), "session_id": "sid-123"}
    image_val, _mime, sess = extract_image_from_json(payload)
    assert sess == "sid-123"
    assert image_val is not None
    assert sniff_image_mime(decode_base64_image(image_val)) == "image/svg+xml"
