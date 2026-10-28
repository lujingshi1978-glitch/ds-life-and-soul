"""Create a raster PDF preview from Artifact Tool's verified slide PNGs.

This script does not draw, edit or generate images. The editable original is
the PPTX. The PNG pages come directly from the presentation renderer.
"""
from pathlib import Path
import sys
from reportlab.pdfgen import canvas
from pypdf import PdfReader

root = Path(__file__).resolve().parent.parent
revision = sys.argv[1] if len(sys.argv) > 1 else "r5"
target = root / "output" / f"feiyu-introduction-{revision}-preview.pdf"
page_size = (960, 540)
pdf = canvas.Canvas(str(target), pagesize=page_size, pageCompression=1)
pdf.setTitle("Feiyu - Project Introduction")
pdf.setSubject("Raster preview of the editable introduction presentation")
pdf.setAuthor("Feiyu Contributors")
pdf.setCreator("Feiyu Contributors")
for number in range(1, 15):
    image = root / ".build" / f"slide-{number:02}.png"
    if not image.is_file():
        raise FileNotFoundError(image)
    pdf.drawImage(str(image), 0, 0, width=960, height=540)
    pdf.showPage()
pdf.save()
reader = PdfReader(str(target))
assert len(reader.pages) == 14
assert all(float(p.mediabox.width) == 960 and float(p.mediabox.height) == 540 for p in reader.pages)
print(f"PDF preview: {target}")
