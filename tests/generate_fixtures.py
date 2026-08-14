#!/usr/bin/env python3
"""Generate deterministic synthetic PDFs for AItero tests."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen.canvas import Canvas


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
ROOT_DIR = Path(__file__).resolve().parent.parent
TEXT_PDF = FIXTURE_DIR / "synthetic-multipage.pdf"
IMAGE_ONLY_PDF = FIXTURE_DIR / "synthetic-image-only.pdf"
WIDTH, HEIGHT = letter


class DeterministicCanvas(Canvas):
    """Canvas with stable document identifiers and metadata."""

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("invariant", 1)
        kwargs.setdefault("pageCompression", 1)
        super().__init__(*args, **kwargs)


def draw_text_page(pdf: Canvas, page_number: int, phrase: str) -> None:
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(72, HEIGHT - 90, f"Synthetic fixture page {page_number}")
    pdf.setFont("Helvetica", 12)
    pdf.drawString(72, HEIGHT - 130, phrase)
    pdf.drawString(72, HEIGHT - 154, "This document contains no real user or library data.")
    pdf.showPage()


def create_text_pdf(path: Path) -> None:
    pdf = DeterministicCanvas(str(path), pagesize=letter)
    pdf.setAuthor("AItero test fixtures")
    pdf.setCreator("tests/generate_fixtures.py")
    pdf.setSubject("Synthetic page-range and citation fixture")
    pdf.setTitle("AItero synthetic multipage fixture")

    draw_text_page(pdf, 1, "AITERO-FIRST-PAGE-PHRASE cedar atlas 4101")
    draw_text_page(pdf, 2, "Synthetic control text for page two.")
    draw_text_page(pdf, 3, "AITERO-MIDDLE-PAGE-PHRASE cobalt orchard 4303")

    # Page four is intentionally blank. showPage() still emits a valid PDF page.
    pdf.showPage()

    draw_text_page(pdf, 5, "Synthetic control text for page five.")
    draw_text_page(pdf, 6, "AITERO-LAST-PAGE-PHRASE violet compass 4606")
    pdf.save()


def make_raster_page() -> bytes:
    """Return an RGB PPM image whose letters are pixels, not PDF text."""
    width, height = 960, 420
    pixels = bytearray([255] * width * height * 3)

    def fill_rect(x: int, y: int, w: int, h: int, color: tuple[int, int, int]) -> None:
        for row in range(max(0, y), min(height, y + h)):
            for col in range(max(0, x), min(width, x + w)):
                offset = (row * width + col) * 3
                pixels[offset : offset + 3] = bytes(color)

    # A deterministic, visibly non-empty scan-like raster with no extractable text.
    fill_rect(55, 55, 850, 310, (240, 244, 248))
    fill_rect(80, 80, 12, 260, (31, 41, 55))
    for row in range(7):
        fill_rect(125, 95 + row * 34, 690 - row * 27, 8, (55, 65, 81))
    fill_rect(690, 245, 165, 70, (180, 199, 220))

    header = f"P6\n{width} {height}\n255\n".encode("ascii")
    return header + pixels


def create_image_only_pdf(path: Path) -> None:
    from reportlab.lib.utils import ImageReader

    pdf = DeterministicCanvas(str(path), pagesize=letter)
    pdf.setAuthor("AItero test fixtures")
    pdf.setCreator("tests/generate_fixtures.py")
    pdf.setSubject("Synthetic image-only PDF fixture")
    pdf.setTitle("AItero synthetic image-only fixture")
    raster = ImageReader(BytesIO(make_raster_page()))
    pdf.drawImage(raster, 54, 198, width=504, height=294, mask="auto")
    pdf.showPage()
    pdf.save()


def main() -> None:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    create_text_pdf(TEXT_PDF)
    create_image_only_pdf(IMAGE_ONLY_PDF)
    print(TEXT_PDF.relative_to(ROOT_DIR))
    print(IMAGE_ONLY_PDF.relative_to(ROOT_DIR))


if __name__ == "__main__":
    main()
