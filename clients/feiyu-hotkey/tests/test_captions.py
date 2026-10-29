"""Real Qt captions and preference persistence, without microphone or hotkeys."""
import os
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication
from feiyu_hotkey.config import Settings,ConfigError,save_settings,load_settings
from feiyu_hotkey.captions import CaptionOverlay

class CaptionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app=QApplication.instance() or QApplication([])
    def test_small_non_activating_click_through_and_long_reply(self):
        caption=CaptionOverlay(Settings())
        try:
            caption.show_message("肥鱼："+"很长的回答"*200)
            self.app.processEvents()
            self.assertTrue(caption.isVisible())
            self.assertLessEqual(len(caption.label.text()),320)
            self.assertTrue(caption.label.text().endswith("很长的回答"))
            self.assertTrue(caption.windowFlags()&Qt.WindowType.WindowTransparentForInput)
            self.assertTrue(caption.windowFlags()&Qt.WindowType.WindowDoesNotAcceptFocus)
            self.assertLess(caption.height(),160)
            self.assertLessEqual(caption.width(),640)
            caption.finish()
            self.assertTrue(caption.hide_timer.isActive())
        finally:caption.close()
    def test_preferences_roundtrip_old_config_and_disabled_captions(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"prefs.json"
            path.write_text('{"version":1,"hotkey":"Ctrl+Alt+Space"}',encoding="utf8")
            self.assertTrue(load_settings(path).caption_enabled)
            settings=replace(load_settings(path),caption_opacity=.4,caption_width=360,caption_x=99999//2,caption_y=-40000,caption_font_size=24,caption_hold_seconds=0)
            save_settings(path,settings)
            self.assertEqual(load_settings(path),settings)
            caption=CaptionOverlay(settings)
            try:
                caption.show_message("不会发送消息")
                area=QApplication.primaryScreen().availableGeometry()
                self.assertTrue(area.contains(caption.geometry()))
                caption.finish();self.assertFalse(caption.hide_timer.isActive())
                caption.apply_preferences(replace(settings,caption_enabled=False));self.assertFalse(caption.isVisible())
            finally:caption.close()
    def test_invalid_preferences_are_rejected(self):
        for values in ({"caption_opacity":float('nan')},{"caption_width":True},{"caption_font_size":3},{"caption_x":50001},{"caption_hold_seconds":-1}):
            with self.assertRaises(ConfigError):replace(Settings(),**values).validate()

if __name__=="__main__":unittest.main()
