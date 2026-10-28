"""Transparent Qt voice/text surface, without pets, animations or desktop tools."""
from __future__ import annotations

import queue
import tempfile
from dataclasses import replace
from pathlib import Path

from PySide6.QtCore import QPoint, Qt, QTimer, QUrl
from PySide6.QtGui import QColor, QKeySequence, QPainter, QShortcut, QTextCursor
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QDialog,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMenu,
    QPlainTextEdit,
    QPushButton,
    QStyle,
    QSystemTrayIcon,
    QVBoxLayout,
    QWidget,
)

from .config import ConfigError, Settings, read_token, save_settings
from .hotkey import HotkeyService
from .hotkey_spec import normalize
from .transport import ChatError
from .voice import VoiceController


class VoiceOverlay(QWidget):
    def __init__(self, settings: Settings, config_path: Path, no_hotkey: bool = False,
                 controller: VoiceController | None = None, initial_error: str = "", no_playback: bool = False):
        super().__init__()
        self.settings, self.config_path = settings, config_path
        self.no_hotkey, self.no_playback = no_hotkey, no_playback
        self.controller = controller or VoiceController()
        self.hotkey: HotkeyService | None = None
        self.system_events = queue.Queue()
        self._exiting = False
        self._drag_origin: QPoint | None = None
        self._reply_started = False
        self._audio_queue: list[Path] = []
        self._audio_files: list[Path] = []
        self._cache = tempfile.TemporaryDirectory(prefix="feiyu-voice-")
        self.setWindowTitle("肥鱼 · 快捷语音")
        self.setWindowFlags(Qt.WindowType.Window | Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.resize(600, 450)
        self.setMinimumSize(460, 330)
        self._build()
        self.output_audio = QAudioOutput(self)
        self.output_audio.setVolume(0.8)
        self.player = QMediaPlayer(self)
        self.player.setAudioOutput(self.output_audio)
        self.player.mediaStatusChanged.connect(self._media_status)
        self.player.errorOccurred.connect(self._media_error)
        self._build_tray()
        self._register_hotkey()
        if initial_error:
            self.status.setText(initial_error)
        else:
            try:
                read_token(settings)
            except ConfigError as error:
                self.status.setText(str(error))
        self.timer = QTimer(self)
        self.timer.setInterval(60)
        self.timer.timeout.connect(self._poll)
        self.timer.start()

    def _build(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 16, 20, 16)
        layout.setSpacing(10)
        header = QHBoxLayout()
        title = QLabel("肥鱼 · 快捷语音")
        title.setObjectName("title")
        title.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        header.addWidget(title)
        header.addStretch()
        self.hide_button = QPushButton("隐藏")
        self.hide_button.clicked.connect(self.hide_or_minimize)
        header.addWidget(self.hide_button)
        layout.addLayout(header)
        self.hint = QLabel(f"{self.settings.hotkey} 开始录音 · 再按结束 · 停顿后自动发送")
        self.hint.setWordWrap(True)
        layout.addWidget(self.hint)
        self.output = QPlainTextEdit()
        self.output.setReadOnly(True)
        self.output.setPlaceholderText("与你在 DSH、QQ 中认识的同一个肥鱼说话。\n识别文字和回复会显示在这里。")
        self.output.setAccessibleName("识别与聊天内容")
        self.output.document().setMaximumBlockCount(600)
        layout.addWidget(self.output, 1)
        self.input = QPlainTextEdit()
        self.input.setMaximumHeight(68)
        self.input.setPlaceholderText("也可以直接打字 · Ctrl+Enter 发送")
        self.input.setAccessibleName("文字消息")
        layout.addWidget(self.input)
        actions = QHBoxLayout()
        self.record_button = QPushButton("开始说话")
        self.record_button.clicked.connect(self.toggle_voice)
        self.send_button = QPushButton("发送文字")
        self.send_button.clicked.connect(self.send_text)
        self.cancel_button = QPushButton("取消")
        self.cancel_button.setEnabled(False)
        self.cancel_button.clicked.connect(self.cancel)
        self.settings_button = QPushButton("设置")
        self.settings_button.clicked.connect(self.configure)
        self.quit_button = QPushButton("退出")
        self.quit_button.clicked.connect(self.quit)
        for button in (self.record_button, self.send_button, self.cancel_button):
            actions.addWidget(button)
        actions.addStretch()
        actions.addWidget(self.settings_button)
        actions.addWidget(self.quit_button)
        layout.addLayout(actions)
        self.status = QLabel("就绪")
        self.status.setWordWrap(True)
        self.status.setAccessibleName("录音与回复状态")
        layout.addWidget(self.status)
        QShortcut(QKeySequence("Ctrl+Return"), self, activated=self.send_text)
        QShortcut(QKeySequence("Escape"), self, activated=self.hide_or_minimize)
        QShortcut(QKeySequence("Ctrl+Q"), self, activated=self.quit)
        self.setStyleSheet("""
            QWidget {color: #f6f7f9; font-size: 13px;}
            QLabel#title {font-size: 18px; font-weight: 600;}
            QPlainTextEdit {background: rgba(15,20,28,125); border: 1px solid #687381;
                border-radius: 8px; padding: 8px; selection-background-color: #356a9b;}
            QPushButton {background: #343f4d; border: 1px solid #718091; border-radius: 6px; padding: 6px 10px;}
            QPushButton:hover {background: #465971;}
            QPushButton:focus {border: 2px solid #95c9ff;}
            QPushButton:disabled {color: #9ba6b4; background: #29313c;}
            QLineEdit {background:#222d39; border:1px solid #8794a4; padding:6px;}
            QDialog {background:#202a36;}
        """)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setPen(QColor(110, 132, 155, 220))
        painter.setBrush(QColor(25, 33, 44, 222))
        painter.drawRoundedRect(self.rect().adjusted(1, 1, -1, -1), 16, 16)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton and event.position().y() <= 55:
            self._drag_origin = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if self._drag_origin is not None and event.buttons() & Qt.MouseButton.LeftButton:
            self.move(event.globalPosition().toPoint() - self._drag_origin)
            event.accept()

    def mouseReleaseEvent(self, event):
        self._drag_origin = None

    def _build_tray(self):
        self.tray = QSystemTrayIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_MediaVolume), self)
        self.tray.setToolTip("肥鱼 · 快捷语音")
        menu = QMenu(self)
        menu.addAction("显示 / 隐藏", self.toggle_window)
        menu.addAction("开始 / 结束说话", self.toggle_voice)
        menu.addAction("设置", self.configure)
        menu.addAction("退出", self.quit)
        self.tray.setContextMenu(menu)
        self.tray.activated.connect(lambda reason: self.toggle_window() if reason == QSystemTrayIcon.ActivationReason.Trigger else None)
        if not self.no_hotkey and QSystemTrayIcon.isSystemTrayAvailable():
            self.tray.show()

    def _register_hotkey(self):
        if self.hotkey is not None:
            self.hotkey.close()
        self.hint.setText(f"{self.settings.hotkey} 开始录音 · 再按结束 · 停顿后自动发送")
        if self.no_hotkey:
            self.status.setText("本地验收：未注册全局快捷键")
            return
        self.hotkey = HotkeyService()
        ok = self.hotkey.start(self.settings.hotkey,
                               lambda: self.system_events.put(("voice", "")),
                               lambda text: self.system_events.put(("error", text)))
        self.status.setText("就绪 · 按快捷键或点击开始说话" if ok else self.hotkey.error)

    def show_window(self):
        self.showNormal()
        self.raise_()
        self.activateWindow()

    def toggle_window(self):
        if self.isVisible() and not self.isMinimized():
            self.hide_or_minimize()
        else:
            self.show_window()

    def hide_or_minimize(self):
        if self.tray.isVisible() or (self.hotkey is not None and self.hotkey.registered):
            self.hide()
        else:
            self.showMinimized()

    def _append(self, text):
        self.output.moveCursor(QTextCursor.MoveOperation.End)
        self.output.insertPlainText(text)
        if self.output.document().characterCount() > 100000:
            cursor = self.output.textCursor()
            cursor.setPosition(0)
            cursor.setPosition(self.output.document().characterCount() - 100000, cursor.MoveMode.KeepAnchor)
            cursor.removeSelectedText()
        self.output.ensureCursorVisible()

    def _busy(self, busy: bool):
        self.send_button.setEnabled(not busy)
        self.settings_button.setEnabled(not busy)
        self.cancel_button.setEnabled(busy or bool(self._audio_queue) or self.player.playbackState() == QMediaPlayer.PlaybackState.PlayingState)

    def toggle_voice(self):
        self.show_window()
        if self.controller.phase == "recording" and self.controller.finish_recording():
            self.record_button.setText("录音结束…")
            self.status.setText("录音结束，正在准备识别…")
            return
        if self.controller.active_id is not None:
            self.status.setText("上一句仍在处理中，可以点取消")
            return
        try:
            read_token(self.settings)
            self._stop_playback()
            self.controller.start_voice(self.settings)
        except (ChatError, ConfigError) as error:
            self.status.setText(str(error))
            return
        self._reply_started = False
        self._busy(True)
        self.record_button.setText("结束录音")
        self.status.setText("● 正在录音 · 直接说吧；停顿后发送，再按快捷键也可结束")

    def send_text(self):
        if self.controller.active_id is not None:
            return
        text = self.input.toPlainText().strip()
        try:
            read_token(self.settings)
            self._stop_playback()
            self.controller.start(self.settings, text)
        except (ChatError, ConfigError) as error:
            self.status.setText(str(error))
            return
        self._append("\n你：" + text + "\n肥鱼：")
        self.input.clear()
        self._reply_started = True
        self._busy(True)
        self.status.setText("肥鱼正在想…")

    def cancel(self):
        self._stop_playback()
        if self.controller.cancel():
            self.status.setText("正在取消录音 / 本轮请求…")
        else:
            self.status.setText("已停止语音播放")
            self._busy(False)

    def _poll(self):
        for _ in range(200):
            try:
                kind, text = self.system_events.get_nowait()
            except queue.Empty:
                break
            if kind == "voice":
                self.toggle_voice()
            else:
                self.status.setText(text)
                self.show_window()
        for _ in range(200):
            try:
                event = self.controller.events.get_nowait()
            except queue.Empty:
                break
            event = self.controller.receive(event)
            if event is None:
                continue
            if event.kind == "transcribing":
                self.record_button.setText("开始说话")
                self.status.setText("听到了，正在识别…")
            elif event.kind == "transcript":
                self._append("\n你（语音）：" + event.text + "\n肥鱼：")
                self._reply_started = True
            elif event.kind == "waiting":
                self.status.setText("肥鱼正在想…")
            elif event.kind == "delta":
                self._append(event.text)
                self.status.setText("正在接收回复…")
            elif event.kind == "speaking":
                self.status.setText("文字已回复，正在准备语音…")
            elif event.kind == "audio":
                if not self.no_playback:
                    file = Path(self._cache.name) / f"{len(self._audio_files)}.{event.text}"
                    file.write_bytes(event.audio)
                    self._audio_files.append(file)
                    self._audio_queue.append(file)
                    if self.player.playbackState() != QMediaPlayer.PlaybackState.PlayingState:
                        self._play_next()
            elif event.kind in ("done", "error", "cancelled"):
                self._append("\n")
                self.record_button.setText("开始说话")
                if event.kind == "error":
                    self.status.setText(event.text)
                elif event.kind == "cancelled":
                    self.status.setText("已取消；识别后送出的文字可能已被后端收到")
                elif not self._audio_queue and self.player.playbackState() != QMediaPlayer.PlaybackState.PlayingState:
                    self.status.setText("就绪 · 仍是同一个肥鱼")
                self._busy(False)

    def _play_next(self):
        if self._audio_queue:
            file = self._audio_queue.pop(0)
            self.player.setSource(QUrl.fromLocalFile(str(file)))
            self.player.play()
            self.status.setText("正在播放肥鱼的回复…")
            self.cancel_button.setEnabled(True)
        elif self.controller.active_id is None:
            self.status.setText("就绪 · 仍是同一个肥鱼")
            self.cancel_button.setEnabled(False)

    def _media_status(self, status):
        if status == QMediaPlayer.MediaStatus.EndOfMedia:
            self._play_next()

    def _media_error(self, error, text):
        if error != QMediaPlayer.Error.NoError:
            self._audio_queue.clear()
            self.status.setText("文字已回复，系统未能播放语音；可以继续文字对话")
            self.cancel_button.setEnabled(self.controller.active_id is not None)

    def _stop_playback(self):
        self._audio_queue.clear()
        self.player.stop()
        self.player.setSource(QUrl())
        for file in self._audio_files:
            try:
                file.unlink(missing_ok=True)
            except OSError:
                pass
        self._audio_files.clear()

    def configure(self):
        if self.controller.active_id is not None:
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("快捷语音设置")
        dialog.setMinimumWidth(470)
        form = QFormLayout(dialog)
        url, credentials, hotkey = QLineEdit(self.settings.gateway_url), QLineEdit(self.settings.credentials_file), QLineEdit(self.settings.hotkey)
        form.addRow("本机肥鱼网关", url)
        credentials_row = QHBoxLayout()
        credentials_row.addWidget(credentials)
        browse = QPushButton("选择…")
        def select_file():
            file, _ = QFileDialog.getOpenFileName(dialog, "选择 companion-gateway.json", "", "JSON (*.json)")
            if file:
                credentials.setText(file)
        browse.clicked.connect(select_file)
        credentials_row.addWidget(browse)
        form.addRow("后端凭据文件", credentials_row)
        form.addRow("开始 / 结束录音快捷键", hotkey)
        playback = QCheckBox("播放肥鱼的语音回复")
        playback.setChecked(self.settings.voice_playback)
        form.addRow(playback)
        note = QLabel("只保存凭据文件路径，不复制令牌。默认使用系统麦克风；录音仅在按键或点击后开始。")
        note.setWordWrap(True)
        form.addRow(note)
        save, cancel = QPushButton("保存"), QPushButton("取消")
        actions = QHBoxLayout()
        actions.addWidget(cancel)
        actions.addWidget(save)
        form.addRow(actions)
        cancel.clicked.connect(dialog.reject)
        def commit():
            try:
                value = replace(self.settings, gateway_url=url.text().strip(), credentials_file=credentials.text().strip(), hotkey=normalize(hotkey.text()), voice_playback=playback.isChecked())
                value.validate()
                save_settings(self.config_path, value)
            except (ConfigError, OSError) as error:
                note.setText(str(error) if isinstance(error, ConfigError) else "无法保存设置，请检查目录写入权限")
                return
            self.settings = value
            self._register_hotkey()
            dialog.accept()
        save.clicked.connect(commit)
        dialog.exec()

    def closeEvent(self, event):
        if self._exiting:
            event.accept()
        else:
            self.hide_or_minimize()
            event.ignore()

    def quit(self):
        if self._exiting:
            return
        self._exiting = True
        self.timer.stop()
        self.controller.close()
        if self.hotkey is not None:
            self.hotkey.close()
        self.tray.hide()
        self._stop_playback()
        try:
            self._cache.cleanup()
        except OSError:
            # Some Windows media backends release the file after stop returns.
            # A locked temporary audio file must not prevent application exit.
            pass
        self.close()
        QApplication.instance().quit()
