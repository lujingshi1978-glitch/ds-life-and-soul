"""Package the final PPTX renderer's exact PNG pages as a raster preview.

This script does not draw or edit illustration/screenshot pixels. The original
PPTX retains editable text, tables and mechanism diagrams.
"""
from pathlib import Path
import json
import os
import sys
from reportlab.pdfgen import canvas
from pypdf import PdfReader

root = Path(os.environ.get('FEIYU_DECK_WORKSPACE', Path(__file__).resolve().parent.parent))
revision = sys.argv[1] if len(sys.argv) > 1 else 'philosophy-r5'
renders = root / '.build' / 'final-renders'
slides = json.loads((root / 'output' / 'SLIDE_MAP.json').read_text(encoding='utf-8'))
target = root / 'output' / f'feiyu-introduction-{revision}-preview.pdf'
pdf = canvas.Canvas(str(target), pagesize=(960, 540), pageCompression=1)
pdf.setTitle('Feiyu - Core, Experience and Memory')
pdf.setSubject('Raster preview of the editable Feiyu philosophy presentation')
pdf.setAuthor('Feiyu Contributors')
pdf.setCreator('Feiyu Contributors')
for item in slides:
    image = renders / f"slide-{item['slide']:02}.png"
    if not image.is_file():
        raise FileNotFoundError(image)
    pdf.drawImage(str(image), 0, 0, width=960, height=540)
    pdf.showPage()
pdf.save()
reader = PdfReader(target)
assert len(reader.pages) == len(slides)
assert all(tuple(map(float, (p.mediabox.width, p.mediabox.height))) == (960, 540) for p in reader.pages)
print(f'PDF preview: {target} ({len(slides)} pages)')
