"""Small, non-activating captions; never captures audio or sends a message."""
from __future__ import annotations
from PySide6.QtCore import Qt,QPoint,QTimer
from PySide6.QtGui import QColor,QPainter,QFont,QFontMetrics
from PySide6.QtWidgets import QWidget,QLabel,QVBoxLayout,QApplication

class CaptionOverlay(QWidget):
    def __init__(self,settings,on_move=None):
        super().__init__(None)
        self.settings=settings;self.on_move=on_move;self._drag=None
        self.setWindowTitle("肥鱼 · 字幕")
        self.setWindowFlags(Qt.WindowType.Tool|Qt.WindowType.FramelessWindowHint|Qt.WindowType.WindowStaysOnTopHint|Qt.WindowType.WindowDoesNotAcceptFocus)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
        self.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.label=QLabel(self);self.label.setWordWrap(True);self.label.setTextFormat(Qt.TextFormat.PlainText)
        self.label.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        layout=QVBoxLayout(self);layout.setContentsMargins(16,10,16,10);layout.addWidget(self.label)
        self.hide_timer=QTimer(self);self.hide_timer.setSingleShot(True);self.hide_timer.timeout.connect(self.hide)
        self.apply_preferences(settings)
    def apply_preferences(self,settings):
        settings.validate();visible=self.isVisible();self.settings=settings
        self.setWindowFlag(Qt.WindowType.WindowTransparentForInput,settings.caption_click_through)
        self.setWindowOpacity(float(settings.caption_opacity));font=QFont("Microsoft YaHei");font.setPixelSize(settings.caption_font_size);self.label.setFont(font);self.label.setStyleSheet("color:#f2faf8;background:transparent;")
        self.place(settings.caption_x,settings.caption_y)
        if visible and settings.caption_enabled:self.show()
        if not settings.caption_enabled:self.hide()
    def place(self,x=None,y=None):
        screens=QApplication.screens();screen=next((s for s in screens if x is not None and y is not None and s.availableGeometry().contains(QPoint(x,y))),None) or QApplication.primaryScreen()
        if screen is None:return
        area=screen.availableGeometry();width=min(self.settings.caption_width,max(260,area.width()-32));self.setFixedWidth(width)
        self._resize_text();height=self.height()
        left=area.left()+(area.width()-width)//2 if x is None else max(area.left(),min(x,area.right()-width+1))
        top=area.bottom()-height-28 if y is None else max(area.top(),min(y,area.bottom()-height+1))
        self.move(left,top)
    def _resize_text(self):
        metrics=QFontMetrics(self.label.font());height=metrics.boundingRect(0,0,max(220,self.width()-32),300,Qt.TextFlag.TextWordWrap,self.label.text()).height()+22
        self.setFixedHeight(max(48,min(height,metrics.height()*4+24)))
    def show_message(self,text):
        self.hide_timer.stop()
        if not self.settings.caption_enabled:return
        # Keep the latest complete visible tail as streamed replies grow.
        visible=str(text)[-320:];metrics=QFontMetrics(self.label.font())
        while len(visible)>1 and metrics.boundingRect(0,0,max(220,self.width()-32),2000,Qt.TextFlag.TextWordWrap,visible).height()>metrics.height()*4:
            visible=visible[1:]
        self.label.setText(visible);self._resize_text();self.place(self.settings.caption_x,self.settings.caption_y);self.show()
    def finish(self):
        if self.settings.caption_hold_seconds:self.hide_timer.start(self.settings.caption_hold_seconds*1000)
    def paintEvent(self,event):
        painter=QPainter(self);painter.setRenderHint(QPainter.RenderHint.Antialiasing);painter.setPen(Qt.PenStyle.NoPen);painter.setBrush(QColor(19,42,47,216));painter.drawRoundedRect(self.rect(),10,10)
    def mousePressEvent(self,event):
        if event.button()==Qt.MouseButton.LeftButton and not self.settings.caption_click_through:self._drag=event.globalPosition().toPoint()-self.pos();event.accept()
    def mouseMoveEvent(self,event):
        if self._drag is not None and event.buttons()&Qt.MouseButton.LeftButton:self.move(event.globalPosition().toPoint()-self._drag);event.accept()
    def mouseReleaseEvent(self,event):
        if self._drag is not None:
            self._drag=None
            if self.on_move:self.on_move(self.x(),self.y())
