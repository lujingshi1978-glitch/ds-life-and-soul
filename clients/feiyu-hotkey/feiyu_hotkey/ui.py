"""Native Tk controls; all UI access stays on the main thread."""
from __future__ import annotations

import queue
import tkinter as tk
from dataclasses import replace
from pathlib import Path
from tkinter import filedialog, ttk

from .config import ConfigError, Settings, read_token, save_settings
from .controller import ChatController
from .hotkey import HotkeyService
from .hotkey_spec import normalize
from .transport import ChatError


class ChatWindow:
    def __init__(self, root: tk.Tk, settings: Settings, config_path: Path,
                 no_hotkey: bool = False, controller: ChatController | None = None,
                 initial_error: str = "") -> None:
        self.root, self.settings, self.config_path = root, settings, config_path
        self.controller = controller or ChatController()
        self.no_hotkey = no_hotkey
        self.hotkey: HotkeyService | None = None
        self.system_events: queue.Queue[tuple[str, str]] = queue.Queue()
        self.closed = False
        self.has_delta = False
        self.settings_dialog: tk.Toplevel | None = None
        root.title("肥鱼 · 快捷对话")
        root.geometry("640x580")
        root.minsize(470, 360)
        root.protocol("WM_DELETE_WINDOW", self.hide)
        root.bind("<Escape>", lambda event: self.hide())
        root.bind("<Control-Return>", self.send)
        root.bind("<Control-q>", lambda event: self.quit())
        self._build()
        self._register_hotkey()
        if initial_error:
            self.status.set(initial_error)
        else:
            try:
                read_token(settings)
            except ConfigError as error:
                self.status.set(str(error))
        self._poll_id = root.after(60, self._poll)
        self.input.focus_set()

    def _build(self) -> None:
        frame = ttk.Frame(self.root, padding=18)
        frame.pack(fill="both", expand=True)
        frame.columnconfigure(0, weight=1)
        frame.rowconfigure(2, weight=1)
        ttk.Label(frame, text="肥鱼", font=("Microsoft YaHei UI", 18, "bold")).grid(row=0, column=0, sticky="w")
        self.subtitle = ttk.Label(frame, text="与 DSH 中同一个肥鱼交流 · 记忆由后端统一保存", wraplength=560)
        self.subtitle.grid(row=1, column=0, sticky="ew", pady=(4, 14))
        transcript = ttk.Frame(frame)
        transcript.grid(row=2, column=0, sticky="nsew")
        transcript.rowconfigure(0, weight=1)
        transcript.columnconfigure(0, weight=1)
        self.output = tk.Text(transcript, wrap="word", state="disabled", padx=12, pady=12,
                              relief="solid", borderwidth=1, font=("Microsoft YaHei UI", 10),
                              background="#ffffff", foreground="#252525", takefocus=True)
        self.output.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(transcript, orient="vertical", command=self.output.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.output.configure(yscrollcommand=scroll.set)
        self.output.tag_configure("speaker", foreground="#145b9b", spacing1=10, spacing3=4)
        self.output.tag_configure("notice", foreground="#666666", spacing1=4)
        self._append(f"按 {self.settings.hotkey} 显示或隐藏。输入文字后按 Ctrl+Enter 发送。\n", "notice")
        ttk.Label(frame, text="消息（Ctrl+Enter 发送，Shift+Enter / Enter 换行）").grid(row=3, column=0, sticky="w", pady=(14, 5))
        self.input = tk.Text(frame, height=3, wrap="word", font=("Microsoft YaHei UI", 10),
                             relief="solid", borderwidth=1, padx=8, pady=6)
        self.input.grid(row=4, column=0, sticky="ew")
        actions = ttk.Frame(frame)
        actions.grid(row=5, column=0, sticky="ew", pady=(10, 8))
        self.send_button = ttk.Button(actions, text="发送", command=self.send, width=8)
        self.send_button.pack(side="left")
        self.cancel_button = ttk.Button(actions, text="取消回复", command=self.cancel, state="disabled")
        self.cancel_button.pack(side="left", padx=(8, 0))
        ttk.Button(actions, text="设置", command=self.configure).pack(side="right")
        ttk.Button(actions, text="退出", command=self.quit).pack(side="right", padx=(8, 8))
        ttk.Button(actions, text="隐藏", command=self.hide).pack(side="right")
        self.status = tk.StringVar(value="就绪")
        self.status_label = ttk.Label(frame, textvariable=self.status, wraplength=560)
        self.status_label.grid(row=6, column=0, sticky="ew")
        self.root.bind("<Configure>", self._resize, add=True)

    def _resize(self, event) -> None:
        if event.widget is self.root:
            width = max(200, event.width - 40)
            self.status_label.configure(wraplength=width)
            self.subtitle.configure(wraplength=width)

    def _append(self, text: str, tag: str = "") -> None:
        self.output.configure(state="normal")
        self.output.insert("end", text, tag)
        # In-memory display is bounded; durable conversation belongs to Feiyu.
        length = self.output.count("1.0", "end-1c", "chars")[0]
        if length > 100000:
            self.output.delete("1.0", f"1.0+{length - 100000}c")
        self.output.configure(state="disabled")
        self.output.see("end")

    def _register_hotkey(self) -> None:
        if self.hotkey is not None:
            self.hotkey.close()
        if self.no_hotkey:
            self.status.set("测试模式：未注册全局快捷键")
            return
        self.hotkey = HotkeyService()
        ok = self.hotkey.start(self.settings.hotkey,
                               lambda: self.system_events.put(("toggle", "")),
                               lambda text: self.system_events.put(("error", text)))
        self.status.set(f"{self.settings.hotkey} 显示 / 隐藏 · 就绪" if ok else self.hotkey.error)

    def toggle(self) -> None:
        if self.settings_dialog is not None and self.settings_dialog.winfo_exists():
            self.settings_dialog.lift()
            return
        if self.root.state() in ("withdrawn", "iconic"):
            self.root.deiconify()
            self.root.lift()
            self.input.focus_force()
        else:
            self.hide()

    def hide(self) -> None:
        if self.settings_dialog is not None and self.settings_dialog.winfo_exists():
            return
        # A failed hotkey must never strand a hidden, unreachable process.
        if self.hotkey is not None and self.hotkey.registered:
            self.root.withdraw()
        else:
            self.root.iconify()

    def send(self, event=None):
        if self.controller.active_id is not None:
            return "break"
        text = self.input.get("1.0", "end-1c").strip()
        try:
            read_token(self.settings)
            self.controller.start(self.settings, text)
        except (ConfigError, ChatError) as error:
            self.status.set(str(error))
            return "break"
        self.has_delta = False
        self._append("\n你\n", "speaker")
        self._append(text + "\n")
        self._append("肥鱼\n", "speaker")
        self.input.delete("1.0", "end")
        self.send_button.configure(state="disabled")
        self.cancel_button.configure(state="normal")
        self.status.set("等待肥鱼回复… 可以取消；隐藏窗口不会取消")
        return "break"

    def cancel(self) -> None:
        if self.controller.cancel():
            self.status.set("正在取消本轮回复…")
            self.cancel_button.configure(state="disabled")

    def _poll(self) -> None:
        if self.closed:
            return
        for _ in range(200):
            try:
                kind, text = self.system_events.get_nowait()
            except queue.Empty:
                break
            if kind == "toggle":
                self.toggle()
            else:
                self.status.set(text)
                self.root.deiconify()
        for _ in range(200):
            try:
                event = self.controller.events.get_nowait()
            except queue.Empty:
                break
            event = self.controller.receive(event)
            if event is None:
                continue
            if event.kind == "delta":
                self.has_delta = True
                self._append(event.text)
                self.status.set("正在接收回复…")
            elif event.kind in ("done", "cancelled", "error"):
                if event.kind == "done":
                    self._append("\n" if self.has_delta else "（肥鱼本轮没有发出回复）\n", "notice")
                    self.status.set(f"{self.settings.hotkey} 显示 / 隐藏 · 就绪")
                else:
                    message = "已取消本轮回复；后端可能已收到你的文字" if event.kind == "cancelled" else event.text
                    self._append("\n[" + message + "]\n", "notice")
                    self.status.set(message)
                self.send_button.configure(state="normal")
                self.cancel_button.configure(state="disabled")
        self._poll_id = self.root.after(60, self._poll)

    def configure(self) -> None:
        if self.settings_dialog is not None and self.settings_dialog.winfo_exists():
            self.settings_dialog.lift()
            return
        dialog = self.settings_dialog = tk.Toplevel(self.root)
        dialog.title("肥鱼快捷对话 · 设置")
        dialog.transient(self.root)
        dialog.minsize(460, 340)
        body = ttk.Frame(dialog, padding=18)
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=1)
        ttk.Label(body, text="连接到同一个肥鱼", font=("Microsoft YaHei UI", 13, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(body, text="只读取后端的 pet 凭据，不会复制令牌或修改后端账号。", wraplength=460).grid(row=1, column=0, sticky="ew", pady=(6, 14))
        url = tk.StringVar(value=self.settings.gateway_url)
        credentials = tk.StringVar(value=self.settings.credentials_file)
        hotkey = tk.StringVar(value=self.settings.hotkey)
        for row, title, variable in [(2, "本机网关地址", url), (4, "后端凭据文件（companion-gateway.json）", credentials), (7, "显示 / 隐藏快捷键", hotkey)]:
            ttk.Label(body, text=title).grid(row=row, column=0, sticky="w", pady=(6, 4))
            ttk.Entry(body, textvariable=variable).grid(row=row + 1, column=0, sticky="ew")

        def browse() -> None:
            selected = filedialog.askopenfilename(parent=dialog, title="选择后端 companion-gateway.json", filetypes=[("JSON 文件", "*.json"), ("所有文件", "*.*")])
            if selected:
                credentials.set(selected)

        ttk.Button(body, text="选择文件…", command=browse).grid(row=6, column=0, sticky="e", pady=(6, 0))
        note = tk.StringVar(value="也可由启动环境提供 FEIYU_PET_TOKEN。设置文件只保存路径和快捷键。")
        ttk.Label(body, textvariable=note, wraplength=460).grid(row=9, column=0, sticky="ew", pady=(12, 10))
        actions = ttk.Frame(body)
        actions.grid(row=10, column=0, sticky="e")

        def save() -> None:
            try:
                candidate = replace(self.settings, gateway_url=url.get().strip(), credentials_file=credentials.get().strip(), hotkey=normalize(hotkey.get()))
                candidate.validate()
                save_settings(self.config_path, candidate)
            except (ConfigError, OSError) as error:
                note.set(str(error) if isinstance(error, ConfigError) else "无法保存设置，请检查目录写入权限")
                return
            self.settings = candidate
            self._register_hotkey()
            dialog.destroy()
            self.input.focus_set()

        ttk.Button(actions, text="取消", command=dialog.destroy).pack(side="left", padx=(0, 8))
        ttk.Button(actions, text="保存", command=save).pack(side="left")
        dialog.bind("<Escape>", lambda event: dialog.destroy())
        dialog.grab_set()

    def quit(self) -> None:
        if self.closed:
            return
        self.closed = True
        self.root.after_cancel(self._poll_id)
        self.controller.close()
        if self.hotkey is not None:
            self.hotkey.close()
        self.root.destroy()
