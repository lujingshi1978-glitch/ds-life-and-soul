"""Render the real caption widget with synthetic text; no mic, hotkey or network.

Usage: python render-caption-demo.py REPOSITORY_ROOT OUTPUT_PNG
This is a direct screenshot of the application widget, not a UI mockup.
"""
import os
os.environ['QT_QPA_PLATFORM'] = 'offscreen'
import sys
sys.dont_write_bytecode = True
from dataclasses import replace
from pathlib import Path

repo = Path(sys.argv[1]).resolve(strict=True)
target = Path(sys.argv[2]).resolve()
sys.path.insert(0, str(repo / 'clients' / 'feiyu-hotkey'))
from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QFontDatabase, QRawFont
from feiyu_hotkey.config import Settings
from feiyu_hotkey.captions import CaptionOverlay

app = QApplication([])
# The offscreen Qt plugin may not enumerate Windows fonts automatically.
font_path = Path(os.environ.get('FEIYU_DEMO_FONT', str(Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / 'msyh.ttc')))
if not font_path.is_file() or QFontDatabase.addApplicationFont(str(font_path)) < 0:
    raise RuntimeError('A readable Microsoft YaHei font is required for the Chinese demo')
settings = replace(Settings(), caption_width=620, caption_font_size=24, caption_opacity=.86)
widget = CaptionOverlay(settings)
try:
    if not QRawFont.fromFont(widget.label.font()).supportsCharacter('肥'):
        raise RuntimeError('The selected caption font has no Chinese glyphs')
    widget.show_message('你：今天想聊什么？\n肥鱼：在呀，慢慢说。')
    app.processEvents()
    target.parent.mkdir(parents=True, exist_ok=True)
    if not widget.grab().save(str(target)):
        raise RuntimeError('Could not save the actual caption widget')
    print(f'Actual Qt caption, synthetic text: {target}')
finally:
    widget.close()
