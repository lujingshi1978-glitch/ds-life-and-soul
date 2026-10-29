"""Public preferences contain no secrets; credentials stay with the backend."""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .hotkey_spec import normalize


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    gateway_url: str = "http://127.0.0.1:3116/pet"
    credentials_file: str = ""
    hotkey: str = "Ctrl+Alt+Space"
    timeout_seconds: int = 180
    voice_playback: bool = True
    caption_enabled: bool = True
    caption_opacity: float = 0.86
    caption_font_size: int = 18
    caption_width: int = 640
    caption_x: int | None = None
    caption_y: int | None = None
    caption_hold_seconds: int = 10
    caption_click_through: bool = True

    def validate(self) -> Settings:
        try:
            url = urlsplit(self.gateway_url)
            port = url.port
        except ValueError:
            raise ConfigError("本机网关地址格式无效") from None
        if (url.scheme != "http" or url.hostname != "127.0.0.1"
                or url.path.rstrip("/") != "/pet" or url.username or url.password
                or url.query or url.fragment or port is None):
            raise ConfigError("网关仅允许 http://127.0.0.1:端口/pet")
        if not 1 <= port <= 65535:
            raise ConfigError("网关端口无效")
        if not normalize(self.hotkey):
            raise ConfigError("快捷键须包含修饰键，例如 Ctrl+Alt+F9")
        if type(self.timeout_seconds) is not int or not 5 <= self.timeout_seconds <= 600:
            raise ConfigError("等待时间须在 5 到 600 秒之间")
        if not isinstance(self.credentials_file, str):
            raise ConfigError("凭据文件路径格式无效")
        if type(self.voice_playback) is not bool:
            raise ConfigError("语音播放设置格式无效")
        for name in ("caption_enabled", "caption_click_through"):
            if type(getattr(self,name)) is not bool:
                raise ConfigError("字幕开关格式无效")
        if type(self.caption_opacity) not in (int,float) or not 0.2 <= self.caption_opacity <= 1:
            raise ConfigError("字幕不透明度须在20%至100%之间")
        for name,low,high in (("caption_font_size",12,40),("caption_width",260,1800),("caption_hold_seconds",0,120)):
            value=getattr(self,name)
            if type(value) is not int or not low <= value <= high:
                raise ConfigError("字幕尺寸或停留时间无效")
        for value in (self.caption_x,self.caption_y):
            if value is not None and (type(value) is not int or not -50000 <= value <= 50000):
                raise ConfigError("字幕位置无效")
        return self

    @property
    def port(self) -> int:
        self.validate()
        return urlsplit(self.gateway_url).port  # type: ignore[return-value]


def default_path() -> Path:
    explicit = os.environ.get("FEIYU_HOTKEY_CONFIG")
    if explicit:
        return Path(explicit).expanduser()
    return Path(os.environ.get("APPDATA", str(Path.home() / ".config"))) / "FeiyuHotkey" / "config.json"


def load_settings(path: Path) -> Settings:
    if not path.exists():
        return Settings()
    try:
        if path.stat().st_size > 65536:
            raise ConfigError("客户端设置文件超过大小限制")
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(data, dict) or data.get("version", 1) != 1:
            raise ConfigError("客户端设置版本无效")
        if any(k in data for k in ("token", "pet", "api_key", "password")):
            raise ConfigError("不要在客户端设置中保存令牌，请使用凭据文件或环境变量")
        allowed = set(Settings.__dataclass_fields__)
        if set(data) - allowed - {"version"}:
            raise ConfigError("客户端设置含未知字段")
        return Settings(**{k: v for k, v in data.items() if k in allowed}).validate()
    except (OSError, json.JSONDecodeError, TypeError, AttributeError):
        raise ConfigError("无法读取客户端设置；请修复设置文件或选择其他 --config 路径") from None


def save_settings(path: Path, settings: Settings) -> None:
    settings.validate()
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".config-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump({"version": 1, **asdict(settings)}, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_token(settings: Settings) -> str:
    """Read only the pet capability. Never copy a token into client settings."""
    token = os.environ.get("FEIYU_PET_TOKEN", "")
    if not token and settings.credentials_file:
        try:
            path = Path(settings.credentials_file).expanduser()
            if path.stat().st_size > 65536:
                raise ConfigError("凭据文件超过大小限制")
            value = json.loads(path.read_text(encoding="utf-8-sig"))
            token = value.get("pet", "") if isinstance(value, dict) else ""
        except (OSError, json.JSONDecodeError):
            raise ConfigError("无法读取所选凭据文件；请检查路径和访问权限") from None
    if not isinstance(token, str) or not token:
        raise ConfigError("请在设置中选择肥鱼的 companion-gateway.json，或设置 FEIYU_PET_TOKEN")
    if len(token) > 4096 or not token.isascii() or any(ord(c) < 33 or ord(c) > 126 for c in token):
        raise ConfigError("pet 凭据格式无效")
    return token
