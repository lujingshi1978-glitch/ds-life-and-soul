"""Set generic release authorship without changing document page content."""
from pathlib import Path
import os
import re
import sys
import zipfile

AUTHOR = "Feiyu Contributors"


def normalize(target: Path) -> None:
    target = target.resolve(strict=True)
    temporary = target.with_name(target.name + ".metadata.tmp")
    if target.suffix.lower() == ".pptx":
        with zipfile.ZipFile(target) as source, zipfile.ZipFile(temporary, "w") as output:
            for entry in source.infolist():
                data = source.read(entry.filename)
                if entry.filename == "docProps/core.xml":
                    xml = data.decode("utf-8")
                    xml = re.sub(r"<dc:creator>.*?</dc:creator>", f"<dc:creator>{AUTHOR}</dc:creator>", xml, flags=re.S)
                    def replace_modifier(match):
                        tag = match.group("tag") or match.group("empty")
                        return f"<{tag}>{AUTHOR}</{tag}>"
                    xml = re.sub(r"<(?P<tag>(?:cp:)?lastModifiedBy)(?:\s[^>]*)?>.*?</(?P=tag)>|<(?P<empty>(?:cp:)?lastModifiedBy)\s*/>", replace_modifier, xml, flags=re.S)
                    data = xml.encode("utf-8")
                output.writestr(entry, data)
    elif target.suffix.lower() == ".pdf":
        from pypdf import PdfReader, PdfWriter
        source = PdfReader(target)
        writer = PdfWriter()
        writer.clone_document_from_reader(source)
        writer.add_metadata({"/Author": AUTHOR, "/Creator": AUTHOR})
        with temporary.open("wb") as output:
            writer.write(output)
    else:
        raise ValueError("Expected a PPTX or PDF")
    os.replace(temporary, target)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python normalize-metadata.py document.pptx [preview.pdf]")
    for value in sys.argv[1:]:
        normalize(Path(value))
    print(f"Generic release authorship applied to {len(sys.argv) - 1} document(s).")
