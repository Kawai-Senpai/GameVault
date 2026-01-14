"""
GameVault - Main Window UI
Modern dark theme game save backup manager
Designed by Ranit Bhowmick (ranitbhowmick.com)

References:
- Brand Design System at E:/Web Development/_Projects/Portfolio/frontend/doc/DESIGN_SYSTEM.md
"""

import os
import sys
import platform
import webbrowser
import threading
from datetime import datetime
from pathlib import Path
from tkinter import messagebox, filedialog
from typing import Any, Dict, List, Optional

import customtkinter as ctk

from core.config_manager import ConfigManager
from core.game_db import GameDatabase
from core.backup_engine import BackupEngine
from core.bat_generator import BatGenerator

# ==========================================
# BRAND COLORS (from DESIGN_SYSTEM.md)
# ==========================================
BRAND_COLORS = {
    # Backgrounds
    "bg_dark": "#0a0a0a",       # neutral-950 (body)
    "bg_card": "#171717",       # neutral-900 (cards)
    "bg_hover": "#262626",      # neutral-800 (hover states)
    
    # Borders
    "border": "#262626",        # white/10 equivalent
    "border_hover": "#404040",  # white/20 equivalent
    
    # Text
    "text_primary": "#ffffff",   # white (headings)
    "text_secondary": "#d4d4d4", # neutral-300 (body)
    "text_muted": "#737373",     # neutral-500 (captions)
    
    # Accent (Red)
    "accent": "#ef4444",         # red-500
    "accent_hover": "#dc2626",   # red-600
    "accent_muted": "#7f1d1d",   # red-900
    "accent_bg": "#1a0505",      # red-500/10 equivalent
    
    # Status
    "success": "#4ade80",        # green-400
    "warning": "#facc15",        # yellow-400
    "error": "#f87171",          # red-400
}

FONT_FAMILY = "Montserrat"

APP_ICON_PNG_REL = "assets/GameVault.png"
APP_ICON_ICO_CACHE_REL = "data/.cache/GameVault.ico"

SIDEBAR_GAME_NAME_MAX_CHARS = 22
SIDEBAR_DEVELOPER_MAX_CHARS = 24
HEADER_GAME_NAME_MAX_CHARS = 34
HEADER_DEVELOPER_MAX_CHARS = 32
SUGGESTION_GAME_NAME_MAX_CHARS = 28
SUGGESTION_DEVELOPER_MAX_CHARS = 26
BACKUP_DISPLAY_NAME_MAX_CHARS = 38
COLLECTION_NAME_MAX_CHARS = 24
PROGRESS_GAME_NAME_MAX_CHARS = 26


def resource_path(relative_path: str) -> Path:
    """Resolve resource paths for dev + PyInstaller-style bundles."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    return base / relative_path


def ensure_app_icon_ico() -> Optional[Path]:
    """Generate/update a cached .ico from the PNG for best Windows taskbar support."""
    if platform.system().lower() != "windows":
        return None

    png_path = resource_path(APP_ICON_PNG_REL)
    if not png_path.exists():
        return None

    ico_path = resource_path(APP_ICON_ICO_CACHE_REL)
    try:
        ico_path.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        return None

    try:
        png_mtime = png_path.stat().st_mtime
        ico_mtime = ico_path.stat().st_mtime if ico_path.exists() else 0
    except OSError:
        png_mtime = 0
        ico_mtime = 0

    if (not ico_path.exists()) or (ico_mtime < png_mtime):
        try:
            from PIL import Image  # type: ignore

            with Image.open(png_path) as img:
                img = img.convert("RGBA")
                img.save(
                    ico_path,
                    format="ICO",
                    sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
                )
        except Exception:
            return None

    return ico_path if ico_path.exists() else None


def apply_app_icon(window: Any, *, set_default: bool = False) -> None:
    """Apply GameVault icon to a Tk/CTk window (root + all dialogs)."""
    png_path = resource_path(APP_ICON_PNG_REL)
    if not png_path.exists():
        return

    ico_path = ensure_app_icon_ico()
    if ico_path:
        try:
            window.iconbitmap(str(ico_path))
        except Exception:
            pass

    # Keep a reference on the window object to prevent GC.
    try:
        from PIL import Image, ImageTk  # type: ignore

        with Image.open(png_path) as image:
            image_copy = image.copy()
        window._window_icon_image = ImageTk.PhotoImage(image_copy)
        window.iconphoto(bool(set_default), window._window_icon_image)
        return
    except Exception:
        pass

    try:
        from tkinter import PhotoImage

        window._window_icon_image = PhotoImage(file=str(png_path))
        window.iconphoto(bool(set_default), window._window_icon_image)
    except Exception:
        return


def schedule_app_icon(window: Any, *, set_default: bool = False) -> None:
    """Apply icon multiple times to override CustomTkinter's delayed default icon."""
    if getattr(window, "_gv_icon_schedule_done", False):
        return
    window._gv_icon_schedule_done = True

    def apply_once() -> None:
        apply_app_icon(window, set_default=set_default)

    apply_once()
    for delay_ms in (200, 700, 1500):
        try:
            window.after(delay_ms, apply_once)
        except Exception:
            pass


def safe_close_toplevel(window: Any, *, delay_ms: int = 350) -> None:
    """Close CTkToplevels safely (avoids CustomTkinter deiconify callbacks on destroyed windows)."""
    try:
        window.withdraw()
    except Exception:
        pass

    def destroy_if_exists() -> None:
        try:
            if hasattr(window, "winfo_exists") and window.winfo_exists():
                window.destroy()
        except Exception:
            pass

    try:
        window.after(delay_ms, destroy_if_exists)
    except Exception:
        destroy_if_exists()


def ui_font(*args, **kwargs):
    """Return a CTkFont using the brand font by default."""
    kwargs.setdefault("family", FONT_FAMILY)
    return ctk.CTkFont(*args, **kwargs)


def truncate_text(value: str, max_chars: int) -> str:
    text = (value or "").strip()
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    if max_chars <= 3:
        return text[:max_chars]
    return text[: max_chars - 3].rstrip() + "..."

# ==========================================
# MAIN WINDOW
# ==========================================
class GameVaultWindow(ctk.CTk):
    def __init__(self):
        super().__init__()
        
        # Set appearance
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("dark-blue")
        
        # Set widget scaling (fix for high DPI displays)
        ctk.set_widget_scaling(1.0)
        
        # Window setup
        self.title("GameVault")
        schedule_app_icon(self, set_default=True)
        self.geometry("1000x700")
        self.minsize(800, 600)
        self.configure(fg_color=BRAND_COLORS["bg_dark"])

        # Initialize managers
        self.config_manager = ConfigManager()
        self.config = self.config_manager.load_config()
        self.game_db = GameDatabase()
        self.engine: Optional[BackupEngine] = None
        
        # State
        self.selected_game: Optional[Dict[str, Any]] = None
        self.user_games: List[Dict[str, Any]] = self.config.get("user_games", [])
        
        # Initialize engine if backup directory set
        if self.config.get("backup_directory"):
            self.engine = BackupEngine(self.config["backup_directory"])
        
        # Check if first time
        if not self.config.get("setup_complete"):
            self.after(100, self._show_setup_wizard)
        else:
            self._build_ui()

    def _apply_window_icon(self) -> None:
        schedule_app_icon(self, set_default=True)
    
    # ==========================================
    # SETUP WIZARD
    # ==========================================
    def _show_setup_wizard(self):
        """Show first-time setup wizard"""
        wizard = SetupWizard(self, self.config)
        self.wait_window(wizard)
        
        if wizard.result:
            # Save config
            self.config = wizard.result
            self.config["setup_complete"] = True
            self.config_manager.save_config(self.config)
            
            # Initialize engine
            if self.config.get("backup_directory"):
                self.engine = BackupEngine(self.config["backup_directory"])
            
            self._build_ui()
        else:
            # User cancelled - exit
            self.destroy()
    
    # ==========================================
    # MAIN UI
    # ==========================================
    def _build_ui(self):
        # Main container
        main = ctk.CTkFrame(self, fg_color="transparent")
        main.pack(fill="both", expand=True)
        
        # Sidebar
        self.sidebar = ctk.CTkFrame(
            main,
            width=280,
            fg_color=BRAND_COLORS["bg_card"],
            corner_radius=0
        )
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)
        
        # Sidebar header
        header = ctk.CTkFrame(self.sidebar, fg_color="transparent", height=70)
        header.pack(fill="x")
        header.pack_propagate(False)
        
        ctk.CTkLabel(
            header,
            text="GameVault",
            font=ui_font(size=20, weight="bold"),
            text_color=BRAND_COLORS["text_primary"]
        ).pack(padx=20, pady=20, anchor="w")
        
        # Add game button
        add_btn = ctk.CTkButton(
            self.sidebar,
            text="+ Add Game",
            command=self._show_add_game,
            height=36,
            font=ui_font(size=13, weight="bold"),
            fg_color=BRAND_COLORS["accent"],
            hover_color=BRAND_COLORS["accent_hover"],
            corner_radius=6
        )
        add_btn.pack(fill="x", padx=16, pady=(0, 16))
        
        # Games list
        self.games_scroll = ctk.CTkScrollableFrame(
            self.sidebar,
            fg_color="transparent",
            scrollbar_button_color=BRAND_COLORS["border"],
            scrollbar_button_hover_color=BRAND_COLORS["border_hover"]
        )
        self.games_scroll.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        
        # Bottom section
        bottom = ctk.CTkFrame(self.sidebar, fg_color="transparent", height=90)
        bottom.pack(fill="x", side="bottom")
        bottom.pack_propagate(False)
        
        # Settings button
        settings_btn = ctk.CTkButton(
            bottom,
            text="Settings",
            command=self._show_settings,
            height=32,
            font=ui_font(size=12),
            fg_color="transparent",
            hover_color=BRAND_COLORS["bg_hover"],
            text_color=BRAND_COLORS["text_secondary"],
            anchor="w",
            corner_radius=6
        )
        settings_btn.pack(fill="x", padx=16, pady=(8, 4))
        
        # Author link
        author_btn = ctk.CTkButton(
            bottom,
            text="by RanitBhowmick.com",
            command=lambda: webbrowser.open("https://ranitbhowmick.com"),
            height=28,
            font=ui_font(size=11),
            fg_color="transparent",
            hover_color=BRAND_COLORS["bg_hover"],
            text_color=BRAND_COLORS["text_muted"],
            anchor="center",
            corner_radius=4
        )
        author_btn.pack(fill="x", padx=16, pady=(0, 12))
        
        # Content area
        content = ctk.CTkFrame(main, fg_color=BRAND_COLORS["bg_dark"], corner_radius=0)
        content.pack(side="right", fill="both", expand=True)
        
        # Header area
        self.header = ctk.CTkFrame(
            content,
            height=80,
            fg_color=BRAND_COLORS["bg_card"],
            corner_radius=0
        )
        self.header.pack(fill="x")
        self.header.pack_propagate(False)
        
        # Content scrollable area
        self.content_area = ctk.CTkScrollableFrame(
            content,
            fg_color="transparent",
            scrollbar_button_color=BRAND_COLORS["border"],
            scrollbar_button_hover_color=BRAND_COLORS["border_hover"]
        )
        self.content_area.pack(fill="both", expand=True, padx=32, pady=24)
        
        # Load games
        self._refresh_games()
        self._build_placeholder_content()
    
    def _refresh_games(self):
        """Refresh the games list"""
        for widget in self.games_scroll.winfo_children():
            widget.destroy()
        
        if not self.user_games:
            # Empty state
            empty = ctk.CTkFrame(self.games_scroll, fg_color="transparent")
            empty.pack(fill="x", pady=20)
            
            ctk.CTkLabel(
                empty,
                text="No games added yet",
                font=ui_font(size=13),
                text_color=BRAND_COLORS["text_muted"]
            ).pack()
            
            ctk.CTkLabel(
                empty,
                text="Click '+ Add Game' to get started",
                font=ui_font(size=11),
                text_color=BRAND_COLORS["text_muted"]
            ).pack(pady=(4, 0))
            return
        
        for game in self.user_games:
            self._create_game_button(game)
    
    def _create_game_button(self, game: Dict[str, Any]):
        """Create a game button in the sidebar"""
        is_selected = (
            self.selected_game and 
            self.selected_game.get("id") == game.get("id")
        )
        
        card = ctk.CTkFrame(
            self.games_scroll,
            fg_color=BRAND_COLORS["accent_bg"] if is_selected else BRAND_COLORS["bg_card"],
            corner_radius=10,
            border_width=1,
            border_color=BRAND_COLORS["accent"] if is_selected else BRAND_COLORS["border"]
        )
        card.pack(fill="x", pady=6, padx=4)
        
        inner = ctk.CTkFrame(card, fg_color="transparent")
        inner.pack(fill="x", padx=12, pady=10)
        inner.grid_columnconfigure(1, weight=1)
        
        name_value = (game.get("name") or "").strip()
        icon_letter = name_value[:1].upper() if name_value else "?"
        icon = ctk.CTkFrame(
            inner,
            width=28,
            height=28,
            fg_color=BRAND_COLORS["accent_bg"] if is_selected else BRAND_COLORS["bg_hover"],
            corner_radius=6
        )
        icon.grid(row=0, column=0, rowspan=2, sticky="w", padx=(0, 10))
        icon.pack_propagate(False)
        
        icon_label = ctk.CTkLabel(
            icon,
            text=icon_letter,
            font=ui_font(size=12, weight="bold"),
            text_color=BRAND_COLORS["text_primary"] if is_selected else BRAND_COLORS["text_secondary"]
        )
        icon_label.pack(expand=True)
        
        # Game name
        display_name = truncate_text(game.get("name", "Unknown"), SIDEBAR_GAME_NAME_MAX_CHARS)
        name = ctk.CTkLabel(
            inner,
            text=display_name,
            font=ui_font(size=13, weight="bold"),
            text_color=BRAND_COLORS["text_primary"] if is_selected else BRAND_COLORS["text_secondary"],
            anchor="w"
        )
        name.grid(row=0, column=1, sticky="ew")
        
        # Developer
        developer_text = truncate_text(game.get("developer") or "Custom game", SIDEBAR_DEVELOPER_MAX_CHARS)
        dev = ctk.CTkLabel(
            inner,
            text=developer_text,
            font=ui_font(size=10),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        )
        dev.grid(row=1, column=1, sticky="ew")

        remove_btn = ctk.CTkButton(
            inner,
            text="×",
            command=lambda g=game: self._remove_game(g),
            width=28,
            height=28,
            font=ui_font(size=14, weight="bold"),
            fg_color="transparent",
            hover_color=BRAND_COLORS["accent_muted"],
            text_color=BRAND_COLORS["text_muted"],
            corner_radius=6,
        )
        remove_btn.grid(row=0, column=3, rowspan=2, sticky="e", padx=(8, 0))
        
        status_dot = ctk.CTkFrame(
            inner,
            width=8,
            height=8,
            corner_radius=4,
            fg_color=BRAND_COLORS["accent"] if is_selected else BRAND_COLORS["border"]
        )
        status_dot.grid(row=0, column=2, rowspan=2, sticky="e", padx=(8, 0))
        status_dot.pack_propagate(False)
        
        def apply_state(state: str):
            if state == "selected":
                card.configure(
                    fg_color=BRAND_COLORS["accent_bg"],
                    border_color=BRAND_COLORS["accent"]
                )
                icon.configure(fg_color=BRAND_COLORS["accent"])
                icon_label.configure(text_color=BRAND_COLORS["text_primary"])
                name.configure(text_color=BRAND_COLORS["text_primary"])
                dev.configure(text_color=BRAND_COLORS["text_secondary"])
                status_dot.configure(fg_color=BRAND_COLORS["accent"])
            elif state == "hover":
                card.configure(
                    fg_color=BRAND_COLORS["bg_hover"],
                    border_color=BRAND_COLORS["border_hover"]
                )
                icon.configure(fg_color=BRAND_COLORS["border_hover"])
                icon_label.configure(text_color=BRAND_COLORS["text_primary"])
                name.configure(text_color=BRAND_COLORS["text_primary"])
                dev.configure(text_color=BRAND_COLORS["text_muted"])
                status_dot.configure(fg_color=BRAND_COLORS["accent"])
            else:
                card.configure(
                    fg_color=BRAND_COLORS["bg_card"],
                    border_color=BRAND_COLORS["border"]
                )
                icon.configure(fg_color=BRAND_COLORS["bg_hover"])
                icon_label.configure(text_color=BRAND_COLORS["text_secondary"])
                name.configure(text_color=BRAND_COLORS["text_secondary"])
                dev.configure(text_color=BRAND_COLORS["text_muted"])
                status_dot.configure(fg_color=BRAND_COLORS["border"])
        
        apply_state("selected" if is_selected else "normal")
        
        # Make clickable
        def on_enter(_event):
            if not is_selected:
                apply_state("hover")
        
        def on_leave(_event):
            if not is_selected:
                apply_state("normal")
        
        for widget in [card, inner, icon, icon_label, name, dev, status_dot]:
            widget.bind("<Button-1>", lambda e, g=game: self._select_game(g))
            widget.bind("<Enter>", on_enter)
            widget.bind("<Leave>", on_leave)
            widget.configure(cursor="hand2")
    
    def _select_game(self, game: Dict[str, Any]):
        """Select a game"""
        self.selected_game = game
        self._refresh_games()
        self._build_game_view(game)
    
    def _build_placeholder_content(self):
        """Build placeholder content"""
        for widget in self.header.winfo_children():
            widget.destroy()
        for widget in self.content_area.winfo_children():
            widget.destroy()
        
        # Header placeholder
        ctk.CTkLabel(
            self.header,
            text="Select a game to manage backups",
            font=ui_font(size=14),
            text_color=BRAND_COLORS["text_muted"]
        ).place(relx=0.5, rely=0.5, anchor="center")
        
        # Content placeholder
        placeholder = ctk.CTkFrame(self.content_area, fg_color="transparent")
        placeholder.pack(expand=True)
        
        ctk.CTkLabel(
            placeholder,
            text="GV",
            font=ui_font(size=64)
        ).pack(pady=(0, 16))
        
        ctk.CTkLabel(
            placeholder,
            text="No game selected",
            font=ui_font(size=18, weight="bold"),
            text_color=BRAND_COLORS["text_primary"]
        ).pack()
        
        ctk.CTkLabel(
            placeholder,
            text="Select a game from the sidebar to view and manage backups",
            font=ui_font(size=12),
            text_color=BRAND_COLORS["text_muted"]
        ).pack(pady=(4, 0))
    
    def _build_game_view(self, game: Dict[str, Any]):
        """Build the main view for a selected game"""
        # Clear
        for widget in self.header.winfo_children():
            widget.destroy()
        for widget in self.content_area.winfo_children():
            widget.destroy()
        
        # Header
        header_content = ctk.CTkFrame(self.header, fg_color="transparent")
        header_content.pack(fill="both", expand=True, padx=32, pady=16)
        
        title_row = ctk.CTkFrame(header_content, fg_color="transparent")
        title_row.pack(fill="x")
        title_row.grid_columnconfigure(0, weight=1)
        
        ctk.CTkLabel(
            title_row,
            text=truncate_text(game.get("name", "Unknown"), HEADER_GAME_NAME_MAX_CHARS),
            font=ui_font(size=20, weight="bold"),
            text_color=BRAND_COLORS["text_primary"],
            anchor="w"
        ).grid(row=0, column=0, sticky="w")
        
        # Delete game button (small)
        del_btn = ctk.CTkButton(
            title_row,
            text="Remove",
            command=lambda: self._remove_game(game),
            width=80,
            height=28,
            font=ui_font(size=11),
            fg_color="transparent",
            hover_color=BRAND_COLORS["accent_muted"],
            text_color=BRAND_COLORS["text_muted"]
        )
        del_btn.grid(row=0, column=1, sticky="e", padx=(12, 0))
        
        developer_text = truncate_text(game.get("developer") or "Custom game", HEADER_DEVELOPER_MAX_CHARS)
        ctk.CTkLabel(
            header_content,
            text=developer_text,
            font=ui_font(size=12),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x")
        
        # Actions row
        actions = ctk.CTkFrame(self.content_area, fg_color="transparent")
        actions.pack(fill="x", pady=(0, 20))
        
        ctk.CTkButton(
            actions,
            text="Backup Now",
            command=lambda: self._backup_game(game),
            height=40,
            font=ui_font(size=13, weight="bold"),
            fg_color=BRAND_COLORS["accent"],
            hover_color=BRAND_COLORS["accent_hover"],
            corner_radius=6
        ).pack(side="left", padx=(0, 12))
        
        ctk.CTkButton(
            actions,
            text="Open Save Folder",
            command=lambda: self._open_save_folder(game),
            height=40,
            font=ui_font(size=13),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"],
            corner_radius=6
        ).pack(side="left")

        ctk.CTkButton(
            actions,
            text="Create Backup Script",
            command=lambda: self._generate_quick_backup_bat(game),
            height=40,
            font=ui_font(size=13),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"],
            corner_radius=6
        ).pack(side="left", padx=(12, 0))
        
        # Save path info
        save_path = game.get("save_path", "")
        expanded_path = os.path.expandvars(save_path) if save_path else ""
        path_exists = Path(expanded_path).exists() if expanded_path else False
        
        path_card = ctk.CTkFrame(self.content_area, fg_color=BRAND_COLORS["bg_card"], corner_radius=8)
        path_card.pack(fill="x", pady=(0, 24))
        
        path_inner = ctk.CTkFrame(path_card, fg_color="transparent")
        path_inner.pack(fill="x", padx=16, pady=12)
        
        ctk.CTkLabel(
            path_inner,
            text="Save Location",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x")
        
        status_color = BRAND_COLORS["success"] if path_exists else BRAND_COLORS["error"]
        status_text = expanded_path if path_exists else f"Not found: {expanded_path or 'Not set'}"
        
        ctk.CTkLabel(
            path_inner,
            text=status_text,
            font=ui_font(size=12),
            text_color=status_color,
            anchor="w"
        ).pack(fill="x", pady=(4, 0))

        btn_text = "Change Save Folder" if path_exists else "Set Save Folder"
        ctk.CTkButton(
            path_inner,
            text=btn_text,
            command=lambda g=game: self._set_save_path(g),
            height=28,
            font=ui_font(size=11, weight="bold"),
            fg_color=BRAND_COLORS["accent"],
            hover_color=BRAND_COLORS["accent_hover"],
            corner_radius=6
        ).pack(anchor="w", pady=(8, 0))
        
        # Backups section
        backups_header = ctk.CTkFrame(self.content_area, fg_color="transparent")
        backups_header.pack(fill="x", pady=(0, 12))

        ctk.CTkLabel(
            backups_header,
            text="Backup History",
            font=ui_font(size=16, weight="bold"),
            text_color=BRAND_COLORS["text_primary"],
            anchor="w"
        ).pack(side="left")

        ctk.CTkButton(
            backups_header,
            text="Manage Collections",
            command=lambda g=game: self._show_manage_collections(g),
            height=28,
            font=ui_font(size=11, weight="bold"),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"],
            text_color=BRAND_COLORS["text_secondary"],
            corner_radius=6
        ).pack(side="right")
        
        # Backups list
        backups_frame = ctk.CTkFrame(
            self.content_area,
            fg_color=BRAND_COLORS["bg_card"],
            corner_radius=8
        )
        backups_frame.pack(fill="both", expand=True)
        
        if not self.engine:
            ctk.CTkLabel(
                backups_frame,
                text="Set a backup directory in Settings first",
                font=ui_font(size=12),
                text_color=BRAND_COLORS["text_muted"]
            ).pack(pady=40)
            return
        
        backups = self.engine.get_backups(game.get("id", ""))
        
        if not backups:
            ctk.CTkLabel(
                backups_frame,
                text="No backups yet",
                font=ui_font(size=13),
                text_color=BRAND_COLORS["text_muted"]
            ).pack(pady=(30, 4))
            ctk.CTkLabel(
                backups_frame,
                text="Click 'Backup Now' to create your first backup",
                font=ui_font(size=11),
                text_color=BRAND_COLORS["text_muted"]
            ).pack(pady=(0, 30))
            return
        
        collections = self._get_game_collections(game.get("id", ""))
        collection_map = {collection["id"]: collection["name"] for collection in collections}
        updated = False

        for backup in backups:
            collection_id = backup.get("collection_id") or "default"
            if collection_id not in collection_map:
                collections.append(
                    {
                        "id": collection_id,
                        "name": f"Collection {collection_id[:4].upper()}"
                    }
                )
                collection_map[collection_id] = collections[-1]["name"]
                updated = True

        if updated:
            self.config.setdefault("backup_collections", {})[game.get("id", "")] = collections
            self.config_manager.save_config(self.config)

        def collection_sort_key(item: Dict[str, str]) -> str:
            if item.get("id") == "default":
                return ""
            return item.get("name", "").lower()

        collections_sorted = sorted(collections, key=collection_sort_key)

        for collection in collections_sorted:
            collection_id = collection.get("id", "default")
            collection_name = truncate_text(
                collection.get("name", "Collection"),
                COLLECTION_NAME_MAX_CHARS
            )
            collection_backups = [
                backup for backup in backups
                if (backup.get("collection_id") or "default") == collection_id
            ]

            collection_card = ctk.CTkFrame(
                backups_frame,
                fg_color=BRAND_COLORS["bg_hover"],
                corner_radius=8
            )
            collection_card.pack(fill="x", padx=8, pady=8)

            card_header = ctk.CTkFrame(collection_card, fg_color="transparent")
            card_header.pack(fill="x", padx=16, pady=(12, 4))

            ctk.CTkLabel(
                card_header,
                text=collection_name,
                font=ui_font(size=13, weight="bold"),
                text_color=BRAND_COLORS["text_primary"],
                anchor="w"
            ).pack(side="left")

            ctk.CTkLabel(
                card_header,
                text=f"{len(collection_backups)} backups",
                font=ui_font(size=11),
                text_color=BRAND_COLORS["text_muted"],
                anchor="e"
            ).pack(side="right")

            if not collection_backups:
                ctk.CTkLabel(
                    collection_card,
                    text="No backups in this collection yet.",
                    font=ui_font(size=11),
                    text_color=BRAND_COLORS["text_muted"]
                ).pack(padx=16, pady=(0, 12), anchor="w")
                continue

            backups_inner = ctk.CTkFrame(collection_card, fg_color="transparent")
            backups_inner.pack(fill="both", expand=True, padx=12, pady=(0, 12))

            for backup in collection_backups:
                self._create_backup_row(backups_inner, backup, game)
    
    def _create_backup_row(self, parent, backup: Dict[str, Any], game: Dict[str, Any]):
        """Create a backup row"""
        row = ctk.CTkFrame(parent, fg_color=BRAND_COLORS["bg_hover"], corner_radius=6)
        row.pack(fill="x", pady=3)
        
        inner = ctk.CTkFrame(row, fg_color="transparent")
        inner.pack(fill="x", padx=16, pady=12)
        
        # Info
        info = ctk.CTkFrame(inner, fg_color="transparent")
        info.pack(side="left", fill="x", expand=True)
        
        # Date
        try:
            dt = datetime.fromisoformat(backup.get("backup_time", ""))
            date_str = dt.strftime("%b %d, %Y at %I:%M %p")
        except Exception:
            date_str = backup.get("backup_name", "Unknown")

        # Size info
        size_str = BackupEngine.format_size(backup.get("size", 0))
        compressed = backup.get("is_compressed", False)
        info_text = f"Size: {size_str}" + (" (compressed)" if compressed else "")

        display_name = (backup.get("display_name") or "").strip()
        title_text = display_name if display_name else date_str
        title_text = truncate_text(title_text, BACKUP_DISPLAY_NAME_MAX_CHARS)
        meta_text = f"{date_str} | {info_text}" if display_name else info_text

        ctk.CTkLabel(
            info,
            text=title_text,
            font=ui_font(size=13, weight="bold"),
            text_color=BRAND_COLORS["text_primary"],
            anchor="w"
        ).pack(fill="x")

        ctk.CTkLabel(
            info,
            text=meta_text,
            font=ui_font(size=11),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x")
        
        # Actions
        actions = ctk.CTkFrame(inner, fg_color="transparent")
        actions.pack(side="right")
        
        ctk.CTkButton(
            actions,
            text="Restore",
            command=lambda: self._restore_backup(backup, game),
            width=72,
            height=28,
            font=ui_font(size=11),
            fg_color=BRAND_COLORS["accent_muted"],
            hover_color=BRAND_COLORS["accent"],
            corner_radius=4
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            actions,
            text="Rename",
            command=lambda: self._rename_backup(backup, game),
            width=72,
            height=28,
            font=ui_font(size=11),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"],
            corner_radius=4
        ).pack(side="left", padx=(0, 8))
        
        ctk.CTkButton(
            actions,
            text="Delete",
            command=lambda: self._delete_backup(backup),
            width=60,
            height=28,
            font=ui_font(size=11),
            fg_color="transparent",
            hover_color=BRAND_COLORS["accent_muted"],
            text_color=BRAND_COLORS["text_muted"],
            corner_radius=4
        ).pack(side="left")
    
    # ==========================================
    # ACTIONS
    # ==========================================
    def _show_add_game(self):
        """Show add game dialog"""
        if not isinstance(self.user_games, list):
            self.user_games = []
        dialog = AddGameDialog(self, self.game_db)
        self.wait_window(dialog)
        
        if dialog.result:
            # Add to user games
            self.user_games.append(dialog.result)
            self.config["user_games"] = self.user_games
            self.config_manager.save_config(self.config)
            self._refresh_games()
            self._select_game(dialog.result)

    def _get_game_collections(self, game_id: str) -> List[Dict[str, str]]:
        collections_by_game = self.config.setdefault("backup_collections", {})
        collections = collections_by_game.get(game_id)
        if not collections:
            collections = [{"id": "default", "name": "Main"}]
            collections_by_game[game_id] = collections
            self.config_manager.save_config(self.config)
        if not any(collection.get("id") == "default" for collection in collections):
            collections.insert(0, {"id": "default", "name": "Main"})
            self.config_manager.save_config(self.config)
        return collections

    def _get_collection_map(self, game_id: str) -> Dict[str, str]:
        return {collection["id"]: collection["name"] for collection in self._get_game_collections(game_id)}

    def _collection_is_empty(self, game_id: str, collection_id: str) -> bool:
        if not self.engine:
            return True
        backups = self.engine.get_backups(game_id)
        return not any(backup.get("collection_id") == collection_id for backup in backups)

    def _create_collection(self, game_id: str, name: str) -> Optional[str]:
        name = (name or "").strip()
        if not name:
            return None
        collections = self._get_game_collections(game_id)
        for collection in collections:
            if collection.get("name", "").lower() == name.lower():
                return collection.get("id")
        import uuid
        new_id = uuid.uuid4().hex[:8]
        collections.append({"id": new_id, "name": name})
        self.config_manager.save_config(self.config)
        return new_id

    def _rename_collection(self, game_id: str, collection_id: str, new_name: str) -> Dict[str, Any]:
        new_name = (new_name or "").strip()
        if not new_name:
            return {"success": False, "error": "Collection name is required."}
        collections = self._get_game_collections(game_id)
        for collection in collections:
            if collection.get("id") != collection_id and collection.get("name", "").lower() == new_name.lower():
                return {"success": False, "error": "A collection with that name already exists."}
        for collection in collections:
            if collection.get("id") == collection_id:
                collection["name"] = new_name
                self.config_manager.save_config(self.config)
                return {"success": True, "error": None}
        return {"success": False, "error": "Collection not found."}

    def _delete_collection(self, game_id: str, collection_id: str) -> Dict[str, Any]:
        if collection_id == "default":
            return {"success": False, "error": "The default collection cannot be deleted."}
        if not self._collection_is_empty(game_id, collection_id):
            return {"success": False, "error": "Collection is not empty."}
        collections = self._get_game_collections(game_id)
        updated = [collection for collection in collections if collection.get("id") != collection_id]
        self.config.setdefault("backup_collections", {})[game_id] = updated
        self.config_manager.save_config(self.config)
        return {"success": True, "error": None}

    def _set_save_path(self, game: Dict[str, Any]):
        """Set or update the save folder path for a game."""
        path = filedialog.askdirectory(title="Select Save Folder")
        if not path:
            return
        
        game["save_path"] = path
        
        for existing in self.user_games:
            if existing.get("id") == game.get("id"):
                existing["save_path"] = path
                break
        
        if self.selected_game and self.selected_game.get("id") == game.get("id"):
            self.selected_game["save_path"] = path
        
        self.config["user_games"] = self.user_games
        self.config_manager.save_config(self.config)
        self._build_game_view(game)
    
    def _remove_game(self, game: Dict[str, Any]):
        """Remove a game from the list"""
        if messagebox.askyesno(
            "Remove Game",
            f"Remove {game.get('name')} from your list?\n\nThis won't delete your backups."
        ):
            self.user_games = [g for g in self.user_games if g.get("id") != game.get("id")]
            self.config["user_games"] = self.user_games
            self.config_manager.save_config(self.config)
            self.selected_game = None
            self._refresh_games()
            self._build_placeholder_content()
    
    def _show_settings(self):
        """Show settings dialog"""
        dialog = SettingsDialog(self, self.config)
        self.wait_window(dialog)
        
        if dialog.result:
            self.config = dialog.result
            self.config_manager.save_config(self.config)
            
            # Re-initialize engine
            if self.config.get("backup_directory"):
                self.engine = BackupEngine(self.config["backup_directory"])
            
            # Refresh view
            if self.selected_game:
                self._build_game_view(self.selected_game)

    def _generate_quick_backup_bat(self, game: Dict[str, Any]):
        """Generate a .bat shortcut that runs a CLI backup for this game."""
        game_id = (game.get("id") or "").strip()
        game_name = (game.get("name") or "GameVault Game").strip()
        if not game_id:
            messagebox.showerror("Error", "Game ID missing. Please re-add the game.")
            return

        output_dir = filedialog.askdirectory(title="Choose where to save the .bat file")
        if not output_dir:
            return

        try:
            app_dir = Path(__file__).resolve().parents[1]
            exe_candidate = app_dir / "GameVault.exe"
            exe_path = str(exe_candidate) if exe_candidate.exists() else None

            generator = BatGenerator(app_dir=str(app_dir), exe_path=exe_path)
            bat_path = generator.generate_bat(game_id=game_id, game_name=game_name, output_dir=output_dir)

            messagebox.showinfo(
                "Shortcut Created",
                f"Created:\n{bat_path}\n\nTip: You can place this beside your game's .exe for one-click backups."
            )
        except Exception as e:
            messagebox.showerror("Failed", f"Could not create .bat file:\n{e}")
    
    def _backup_game(self, game: Dict[str, Any]):
        """Backup a game"""
        if not self.engine:
            messagebox.showerror("Error", "Please set a backup directory in Settings first.")
            return
        
        save_path = game.get("save_path", "")
        expanded_path = os.path.expandvars(save_path) if save_path else ""
        
        if not expanded_path or not Path(expanded_path).exists():
            messagebox.showerror("Error", f"Save folder not found:\n{expanded_path}")
            return

        collections = self._get_game_collections(game.get("id", ""))
        dialog = BackupMetaDialog(
            self,
            title="Create Backup",
            primary_label="Create",
            collections=collections,
            initial_collection_id="default"
        )
        self.wait_window(dialog)
        if not dialog.result:
            return

        display_name = dialog.result.get("display_name", "")
        collection_id = dialog.result.get("collection_id", "default")
        new_collection_name = dialog.result.get("new_collection_name", "")

        if new_collection_name:
            created_id = self._create_collection(game.get("id", ""), new_collection_name)
            if not created_id:
                messagebox.showerror("Error", "Please enter a collection name.")
                return
            collection_id = created_id

        self._start_backup(game, expanded_path, display_name, collection_id)

    def _start_backup(self, game: Dict[str, Any], expanded_path: str, display_name: str, collection_id: str):
        """Run backup in a thread with progress UI."""
        if not self.engine:
            return
        
        # Show progress
        progress = ctk.CTkToplevel(self)
        progress.title("Backing up...")
        progress.geometry("320x100")
        schedule_app_icon(progress)
        progress.transient(self)
        progress.grab_set()
        progress.configure(fg_color=BRAND_COLORS["bg_dark"])
        progress.resizable(False, False)
        
        # Center
        progress.update_idletasks()
        x = self.winfo_x() + (self.winfo_width() - 320) // 2
        y = self.winfo_y() + (self.winfo_height() - 100) // 2
        progress.geometry(f"+{x}+{y}")
        
        progress_body = ctk.CTkFrame(progress, fg_color="transparent")
        progress_body.pack(fill="both", expand=True, padx=16, pady=16)
        
        progress_name = truncate_text(game.get("name", ""), PROGRESS_GAME_NAME_MAX_CHARS)
        ctk.CTkLabel(
            progress_body,
            text=f"Backing up {progress_name}...",
            font=ui_font(size=13),
            text_color=BRAND_COLORS["text_secondary"]
        ).pack()
        
        spinner_label = ctk.CTkLabel(
            progress_body,
            text="|",
            font=ui_font(size=18, weight="bold"),
            text_color=BRAND_COLORS["accent"]
        )
        spinner_label.pack(pady=(6, 0))
        
        self._progress_window = progress
        self._spinner_running = True
        
        def spin(index: int = 0):
            if not getattr(self, "_spinner_running", False):
                return
            frames = ["|", "/", "-", "\\"]
            spinner_label.configure(text=frames[index % len(frames)])
            self._spinner_after_id = progress.after(120, lambda: spin(index + 1))
        
        spin()
        
        def do_backup():
            result = self.engine.backup_game(
                game.get("id", ""),
                game.get("name", ""),
                expanded_path,
                display_name=display_name,
                collection_id=collection_id
            )
            self.after(0, lambda: self._on_backup_complete(result, game))
        
        thread = threading.Thread(target=do_backup, daemon=True)
        thread.start()
    
    def _on_backup_complete(self, result: Dict[str, Any], game: Dict[str, Any]):
        """Handle backup completion"""
        if hasattr(self, "_progress_window"):
            self._spinner_running = False
            if hasattr(self, "_spinner_after_id"):
                try:
                    self._progress_window.after_cancel(self._spinner_after_id)
                except Exception:
                    pass
                del self._spinner_after_id
            self._progress_window.destroy()
        
        if result["success"]:
            if result.get("skipped"):
                messagebox.showinfo(
                    "No Changes",
                    f"No backup needed - saves haven't changed since last backup."
                )
            else:
                size_str = BackupEngine.format_size(result.get("compressed_size", 0))
                messagebox.showinfo(
                    "Backup Complete",
                    f"Successfully backed up {game.get('name')}!\n\nSize: {size_str}"
                )
            self._build_game_view(game)
        else:
            messagebox.showerror("Backup Failed", result.get("error", "Unknown error"))

    def _rename_backup(self, backup: Dict[str, Any], game: Dict[str, Any]):
        """Rename a backup or move it to a collection."""
        collections = self._get_game_collections(game.get("id", ""))
        dialog = BackupMetaDialog(
            self,
            title="Edit Backup",
            primary_label="Save",
            collections=collections,
            initial_display_name=backup.get("display_name", ""),
            initial_collection_id=backup.get("collection_id", "default")
        )
        self.wait_window(dialog)
        if not dialog.result:
            return

        display_name = dialog.result.get("display_name", "")
        collection_id = dialog.result.get("collection_id", "default")
        new_collection_name = dialog.result.get("new_collection_name", "")

        if new_collection_name:
            created_id = self._create_collection(game.get("id", ""), new_collection_name)
            if not created_id:
                messagebox.showerror("Error", "Please enter a collection name.")
                return
            collection_id = created_id

        result = self.engine.rename_backup(
            backup.get("path", ""),
            display_name,
            collection_id=collection_id
        )
        if result.get("success"):
            self._build_game_view(game)
        else:
            messagebox.showerror("Rename Failed", result.get("error", "Unknown error"))

    def _show_manage_collections(self, game: Dict[str, Any]):
        dialog = ManageCollectionsDialog(self, game.get("id", ""))
        self.wait_window(dialog)
        if self.selected_game and self.selected_game.get("id") == game.get("id"):
            self._build_game_view(game)
    
    def _restore_backup(self, backup: Dict[str, Any], game: Dict[str, Any]):
        """Restore a backup"""
        if not self.engine:
            return
        
        if not messagebox.askyesno(
            "Restore Backup",
            f"Restore this backup?\n\nThis will overwrite your current saves for {game.get('name')}."
        ):
            return
        
        save_path = game.get("save_path", "")
        expanded_path = os.path.expandvars(save_path) if save_path else ""
        
        result = self.engine.restore_backup(
            backup.get("path", ""),
            expanded_path
        )
        
        if result["success"]:
            messagebox.showinfo("Restored", "Backup restored successfully!")
        else:
            messagebox.showerror("Restore Failed", result.get("error", "Unknown error"))
    
    def _delete_backup(self, backup: Dict[str, Any]):
        """Delete a backup"""
        if not self.engine:
            return
        
        if not messagebox.askyesno("Delete Backup", "Delete this backup permanently?"):
            return
        
        # Get game_id from backup path
        backup_path = Path(backup.get("path", ""))
        if backup_path.exists():
            result = self.engine.delete_backup(str(backup_path))
            
            if result["success"]:
                # Refresh view
                if self.selected_game:
                    self._build_game_view(self.selected_game)
            else:
                messagebox.showerror("Delete Failed", result.get("error", "Unknown error"))
        else:
            messagebox.showerror("Delete Failed", "Backup does not exist")
    
    def _open_save_folder(self, game: Dict[str, Any]):
        """Open save folder in explorer"""
        save_path = game.get("save_path", "")
        expanded_path = os.path.expandvars(save_path) if save_path else ""
        
        if expanded_path and Path(expanded_path).exists():
            os.startfile(expanded_path)
        else:
            messagebox.showerror("Error", f"Folder not found:\n{expanded_path}")


# ==========================================
# SETUP WIZARD
# ==========================================
class SetupWizard(ctk.CTkToplevel):
    """First-time setup wizard"""
    
    def __init__(self, parent, config: Dict[str, Any]):
        super().__init__(parent)
        
        self.title("Welcome to GameVault")
        self.geometry("500x400")
        schedule_app_icon(self)
        self.transient(parent)
        self.grab_set()
        self.configure(fg_color=BRAND_COLORS["bg_dark"])
        self.resizable(False, False)
        self.protocol("WM_DELETE_WINDOW", self._safe_close)
        
        self.config = config.copy()
        self.result = None
        
        # Center
        self.update_idletasks()
        x = parent.winfo_x() + (parent.winfo_width() - 500) // 2
        y = parent.winfo_y() + (parent.winfo_height() - 400) // 2
        self.geometry(f"+{x}+{y}")
        
        self._build_ui()
    
    def _build_ui(self):
        content = ctk.CTkFrame(self, fg_color="transparent")
        content.pack(fill="both", expand=True, padx=40, pady=32)
        
        content.grid_rowconfigure(0, weight=1)
        content.grid_rowconfigure(1, weight=0)
        content.grid_columnconfigure(0, weight=1)
        
        body = ctk.CTkScrollableFrame(
            content,
            fg_color="transparent",
            corner_radius=0,
            scrollbar_button_color=BRAND_COLORS["border"],
            scrollbar_button_hover_color=BRAND_COLORS["border_hover"]
        )
        body.grid(row=0, column=0, sticky="nsew")
        
        # Header
        ctk.CTkLabel(
            body,
            text="GV",
            font=ui_font(size=48)
        ).pack()
        
        ctk.CTkLabel(
            body,
            text="Welcome to GameVault",
            font=ui_font(size=22, weight="bold"),
            text_color=BRAND_COLORS["text_primary"]
        ).pack(pady=(8, 4))
        
        ctk.CTkLabel(
            body,
            text="Let's set up your backup directory",
            font=ui_font(size=13),
            text_color=BRAND_COLORS["text_muted"]
        ).pack(pady=(0, 24))

        ctk.CTkLabel(
            body,
            text="You can name backups and organize them into collections for different playthroughs.",
            font=ui_font(size=11),
            text_color=BRAND_COLORS["text_muted"],
            wraplength=420,
            anchor="w",
            justify="left"
        ).pack(fill="x", pady=(0, 16))

        ctk.CTkLabel(
            body,
            text=(
                "What you’ll get:\n"
                "• One-click backups and restore\n"
                "• Change save folder paths anytime\n"
                "• Generate quick-backup .bat shortcuts"
            ),
            font=ui_font(size=11),
            text_color=BRAND_COLORS["text_muted"],
            justify="left",
            anchor="w",
        ).pack(fill="x", pady=(0, 18))
        
        # Backup directory
        dir_frame = ctk.CTkFrame(body, fg_color="transparent")
        dir_frame.pack(fill="x")
        
        ctk.CTkLabel(
            dir_frame,
            text="Backup Directory",
            font=ui_font(size=12, weight="bold"),
            text_color=BRAND_COLORS["text_primary"],
            anchor="w"
        ).pack(fill="x")
        
        ctk.CTkLabel(
            dir_frame,
            text="Where should we store your game backups?",
            font=ui_font(size=11),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x", pady=(2, 8))
        
        path_row = ctk.CTkFrame(dir_frame, fg_color="transparent")
        path_row.pack(fill="x")
        
        self.dir_entry = ctk.CTkEntry(
            path_row,
            height=40,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            border_color=BRAND_COLORS["border"],
            border_width=1
        )
        self.dir_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))
        
        ctk.CTkButton(
            path_row,
            text="Browse",
            command=self._browse_dir,
            width=80,
            height=40,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"]
        ).pack(side="right")
        
        # Buttons
        btn_frame = ctk.CTkFrame(content, fg_color="transparent")
        btn_frame.grid(row=1, column=0, sticky="ew")
        
        ctk.CTkButton(
            btn_frame,
            text="Cancel",
            command=self._safe_close,
            width=100,
            height=40,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"]
        ).pack(side="left")
        
        ctk.CTkButton(
            btn_frame,
            text="Get Started",
            command=self._finish,
            width=140,
            height=40,
            font=ui_font(size=12, weight="bold"),
            fg_color=BRAND_COLORS["accent"],
            hover_color=BRAND_COLORS["accent_hover"]
        ).pack(side="right")
    
    def _browse_dir(self):
        path = filedialog.askdirectory(title="Select Backup Directory")
        if path:
            self.dir_entry.delete(0, "end")
            self.dir_entry.insert(0, path)
    
    def _finish(self):
        backup_dir = self.dir_entry.get().strip()
        
        if not backup_dir:
            messagebox.showerror("Required", "Please select a backup directory.")
            return
        
        # Create directory if needed
        try:
            Path(backup_dir).mkdir(parents=True, exist_ok=True)
        except Exception as e:
            messagebox.showerror("Error", f"Could not create directory:\n{e}")
            return
        
        self.config["backup_directory"] = backup_dir
        self.result = self.config
        self._safe_close()

    def _safe_close(self):
        safe_close_toplevel(self)


# ==========================================
# BACKUP META DIALOG
# ==========================================
class BackupMetaDialog(ctk.CTkToplevel):
    """Collect backup display name and collection."""

    def __init__(
        self,
        parent: ctk.CTk,
        *,
        title: str,
        primary_label: str,
        collections: List[Dict[str, str]],
        initial_display_name: str = "",
        initial_collection_id: str = "default"
    ):
        super().__init__(parent)

        self.title(title)
        self.geometry("460x360")
        schedule_app_icon(self)
        self.transient(parent)
        self.grab_set()
        self.configure(fg_color=BRAND_COLORS["bg_dark"])
        self.resizable(False, False)
        self.protocol("WM_DELETE_WINDOW", self._safe_close)

        self.primary_label = primary_label
        self.collections = collections
        self.result: Optional[Dict[str, str]] = None

        # Center
        self.update_idletasks()
        x = parent.winfo_x() + (parent.winfo_width() - 460) // 2
        y = parent.winfo_y() + (parent.winfo_height() - 360) // 2
        self.geometry(f"+{x}+{y}")

        self._build_ui(initial_display_name, initial_collection_id)

    def _build_ui(self, initial_display_name: str, initial_collection_id: str) -> None:
        content = ctk.CTkFrame(self, fg_color="transparent")
        content.pack(fill="both", expand=True, padx=28, pady=24)

        content.grid_rowconfigure(0, weight=1)
        content.grid_rowconfigure(1, weight=0)
        content.grid_columnconfigure(0, weight=1)

        body = ctk.CTkFrame(content, fg_color="transparent")
        body.grid(row=0, column=0, sticky="nsew")

        ctk.CTkLabel(
            body,
            text=self.title(),
            font=ui_font(size=18, weight="bold"),
            text_color=BRAND_COLORS["text_primary"],
            anchor="w"
        ).pack(fill="x")

        ctk.CTkLabel(
            body,
            text="Name this backup and choose a collection.",
            font=ui_font(size=12),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x", pady=(4, 16))

        ctk.CTkLabel(
            body,
            text="Backup Name (optional)",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x")

        self.name_entry = ctk.CTkEntry(
            body,
            height=36,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            border_color=BRAND_COLORS["border"],
            border_width=1,
            placeholder_text="e.g., Co-op run, Speedrun, Chapter 3"
        )
        self.name_entry.pack(fill="x", pady=(4, 16))
        if initial_display_name:
            self.name_entry.insert(0, initial_display_name)

        ctk.CTkLabel(
            body,
            text="Collection",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x")

        self.collection_names = [collection["name"] for collection in self.collections]
        self.collection_name_to_id = {collection["name"]: collection["id"] for collection in self.collections}
        self.new_collection_label = "Create new collection"
        options = self.collection_names + [self.new_collection_label]

        self.collection_var = ctk.StringVar(value=self.collection_names[0] if self.collection_names else "")
        for collection in self.collections:
            if collection.get("id") == initial_collection_id:
                self.collection_var.set(collection.get("name", self.collection_var.get()))
                break

        self.collection_menu = ctk.CTkOptionMenu(
            body,
            values=options,
            variable=self.collection_var,
            command=self._on_collection_change,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            button_color=BRAND_COLORS["bg_hover"],
            button_hover_color=BRAND_COLORS["border_hover"],
            dropdown_fg_color=BRAND_COLORS["bg_card"],
            dropdown_hover_color=BRAND_COLORS["bg_hover"],
            dropdown_text_color=BRAND_COLORS["text_secondary"]
        )
        self.collection_menu.pack(fill="x", pady=(4, 8))

        self.new_collection_row = ctk.CTkFrame(body, fg_color="transparent")
        self.new_collection_entry = ctk.CTkEntry(
            self.new_collection_row,
            height=34,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            border_color=BRAND_COLORS["border"],
            border_width=1,
            placeholder_text="New collection name"
        )
        self.new_collection_entry.pack(fill="x")

        self._toggle_new_collection_row(self.collection_var.get() == self.new_collection_label)

        btn_frame = ctk.CTkFrame(content, fg_color="transparent")
        btn_frame.grid(row=1, column=0, sticky="ew", pady=(16, 0))

        ctk.CTkButton(
            btn_frame,
            text="Cancel",
            command=self._safe_close,
            width=100,
            height=36,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"]
        ).pack(side="left")

        ctk.CTkButton(
            btn_frame,
            text=self.primary_label,
            command=self._submit,
            width=120,
            height=36,
            font=ui_font(size=12, weight="bold"),
            fg_color=BRAND_COLORS["accent"],
            hover_color=BRAND_COLORS["accent_hover"]
        ).pack(side="right")

    def _toggle_new_collection_row(self, show: bool) -> None:
        if show:
            self.new_collection_row.pack(fill="x", pady=(0, 8))
        else:
            self.new_collection_row.pack_forget()
            self.new_collection_entry.delete(0, "end")

    def _on_collection_change(self, value: str) -> None:
        self._toggle_new_collection_row(value == self.new_collection_label)

    def _submit(self) -> None:
        display_name = self.name_entry.get().strip()
        selected_name = self.collection_var.get()

        if selected_name == self.new_collection_label:
            new_collection_name = self.new_collection_entry.get().strip()
            if not new_collection_name:
                messagebox.showerror("Required", "Please enter a collection name.")
                return
            collection_id = ""
        else:
            new_collection_name = ""
            collection_id = self.collection_name_to_id.get(selected_name, "default")

        self.result = {
            "display_name": display_name,
            "collection_id": collection_id,
            "new_collection_name": new_collection_name
        }
        self._safe_close()

    def _safe_close(self):
        safe_close_toplevel(self)


# ==========================================
# MANAGE COLLECTIONS DIALOG
# ==========================================
class ManageCollectionsDialog(ctk.CTkToplevel):
    """Manage backup collections for a game."""

    def __init__(self, parent: "GameVaultWindow", game_id: str):
        super().__init__(parent)

        self.parent_window = parent
        self.game_id = game_id
        self.title("Manage Collections")
        self.geometry("560x460")
        schedule_app_icon(self)
        self.transient(parent)
        self.grab_set()
        self.configure(fg_color=BRAND_COLORS["bg_dark"])
        self.resizable(True, True)
        self.protocol("WM_DELETE_WINDOW", self._safe_close)

        # Center
        self.update_idletasks()
        x = parent.winfo_x() + (parent.winfo_width() - 560) // 2
        y = parent.winfo_y() + (parent.winfo_height() - 460) // 2
        self.geometry(f"+{x}+{y}")

        self._build_ui()
        self._refresh_collections()

    def _build_ui(self) -> None:
        content = ctk.CTkFrame(self, fg_color="transparent")
        content.pack(fill="both", expand=True, padx=28, pady=24)

        content.grid_rowconfigure(0, weight=1)
        content.grid_rowconfigure(1, weight=0)
        content.grid_columnconfigure(0, weight=1)

        body = ctk.CTkScrollableFrame(
            content,
            fg_color="transparent",
            corner_radius=0,
            scrollbar_button_color=BRAND_COLORS["border"],
            scrollbar_button_hover_color=BRAND_COLORS["border_hover"]
        )
        body.grid(row=0, column=0, sticky="nsew")

        ctk.CTkLabel(
            body,
            text="Collections",
            font=ui_font(size=18, weight="bold"),
            text_color=BRAND_COLORS["text_primary"],
            anchor="w"
        ).pack(fill="x")

        ctk.CTkLabel(
            body,
            text="Create, rename, or delete collections. Empty collections can be deleted.",
            font=ui_font(size=12),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x", pady=(4, 16))

        ctk.CTkLabel(
            body,
            text="Select Collection",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x")

        self.collection_var = ctk.StringVar(value="")
        self.collection_menu = ctk.CTkOptionMenu(
            body,
            values=[],
            variable=self.collection_var,
            command=lambda _value: self._sync_selection(),
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            button_color=BRAND_COLORS["bg_hover"],
            button_hover_color=BRAND_COLORS["border_hover"],
            dropdown_fg_color=BRAND_COLORS["bg_card"],
            dropdown_hover_color=BRAND_COLORS["bg_hover"],
            dropdown_text_color=BRAND_COLORS["text_secondary"]
        )
        self.collection_menu.pack(fill="x", pady=(4, 12))

        ctk.CTkLabel(
            body,
            text="Rename Selected",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x")

        self.rename_entry = ctk.CTkEntry(
            body,
            height=36,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            border_color=BRAND_COLORS["border"],
            border_width=1
        )
        self.rename_entry.pack(fill="x", pady=(4, 8))

        self.rename_btn = ctk.CTkButton(
            body,
            text="Rename",
            command=self._rename_collection,
            height=30,
            font=ui_font(size=11, weight="bold"),
            fg_color=BRAND_COLORS["accent"],
            hover_color=BRAND_COLORS["accent_hover"],
            corner_radius=6
        )
        self.rename_btn.pack(anchor="w", pady=(0, 16))

        ctk.CTkLabel(
            body,
            text="Create New Collection",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x")

        self.new_entry = ctk.CTkEntry(
            body,
            height=36,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            border_color=BRAND_COLORS["border"],
            border_width=1,
            placeholder_text="New collection name"
        )
        self.new_entry.pack(fill="x", pady=(4, 8))

        ctk.CTkButton(
            body,
            text="Create Collection",
            command=self._create_collection,
            height=30,
            font=ui_font(size=11, weight="bold"),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"],
            corner_radius=6
        ).pack(anchor="w", pady=(0, 16))

        self.delete_hint = ctk.CTkLabel(
            body,
            text="",
            font=ui_font(size=11),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        )
        self.delete_hint.pack(fill="x", pady=(0, 8))

        self.delete_btn = ctk.CTkButton(
            body,
            text="Delete Selected",
            command=self._delete_collection,
            height=30,
            font=ui_font(size=11, weight="bold"),
            fg_color=BRAND_COLORS["accent_muted"],
            hover_color=BRAND_COLORS["accent"],
            corner_radius=6
        )
        self.delete_btn.pack(anchor="w")

        btn_frame = ctk.CTkFrame(content, fg_color="transparent")
        btn_frame.grid(row=1, column=0, sticky="ew", pady=(16, 0))

        ctk.CTkButton(
            btn_frame,
            text="Close",
            command=self._safe_close,
            width=100,
            height=36,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"]
        ).pack(side="right")

    def _refresh_collections(self, select_id: Optional[str] = None) -> None:
        collections = self.parent_window._get_game_collections(self.game_id)
        self.collections = collections
        self.name_to_id = {collection["name"]: collection["id"] for collection in collections}
        names = [collection["name"] for collection in collections]
        self.collection_menu.configure(values=names)

        selected_name = names[0] if names else ""
        if select_id:
            for collection in collections:
                if collection.get("id") == select_id:
                    selected_name = collection.get("name", selected_name)
                    break
        self.collection_var.set(selected_name)
        self.rename_entry.delete(0, "end")
        if selected_name:
            self.rename_entry.insert(0, selected_name)
        self._update_delete_state()

    def _sync_selection(self) -> None:
        selected_name = self.collection_var.get()
        self.rename_entry.delete(0, "end")
        if selected_name:
            self.rename_entry.insert(0, selected_name)
        self._update_delete_state()

    def _update_delete_state(self) -> None:
        selected_name = self.collection_var.get()
        collection_id = self.name_to_id.get(selected_name)
        if not collection_id:
            self.delete_btn.configure(state="disabled")
            self.delete_hint.configure(text="")
            return
        if collection_id == "default":
            self.delete_btn.configure(state="disabled")
            self.delete_hint.configure(text="The default collection cannot be deleted.")
            return
        if not self.parent_window._collection_is_empty(self.game_id, collection_id):
            self.delete_btn.configure(state="disabled")
            self.delete_hint.configure(text="Collection is not empty.")
            return
        self.delete_btn.configure(state="normal")
        self.delete_hint.configure(text="")

    def _create_collection(self) -> None:
        name = self.new_entry.get().strip()
        if not name:
            messagebox.showerror("Required", "Please enter a collection name.")
            return
        new_id = self.parent_window._create_collection(self.game_id, name)
        if not new_id:
            messagebox.showerror("Error", "Unable to create collection.")
            return
        self.new_entry.delete(0, "end")
        self._refresh_collections(select_id=new_id)

    def _rename_collection(self) -> None:
        selected_name = self.collection_var.get()
        collection_id = self.name_to_id.get(selected_name)
        if not collection_id:
            return
        result = self.parent_window._rename_collection(
            self.game_id,
            collection_id,
            self.rename_entry.get()
        )
        if not result.get("success"):
            messagebox.showerror("Rename Failed", result.get("error", "Unknown error"))
            return
        self._refresh_collections(select_id=collection_id)

    def _delete_collection(self) -> None:
        selected_name = self.collection_var.get()
        collection_id = self.name_to_id.get(selected_name)
        if not collection_id:
            return
        result = self.parent_window._delete_collection(self.game_id, collection_id)
        if not result.get("success"):
            messagebox.showerror("Delete Failed", result.get("error", "Unknown error"))
            return
        self._refresh_collections()

    def _safe_close(self) -> None:
        safe_close_toplevel(self)


# ==========================================
# ADD GAME DIALOG
# ==========================================
class AddGameDialog(ctk.CTkToplevel):
    """Dialog for adding a game"""
    
    def __init__(self, parent, game_db: GameDatabase):
        super().__init__(parent)
        
        self.title("Add Game")
        self.geometry("560x620")
        schedule_app_icon(self)
        self.transient(parent)
        self.grab_set()
        self.configure(fg_color=BRAND_COLORS["bg_dark"])
        self.resizable(True, True)
        self.protocol("WM_DELETE_WINDOW", self._safe_close)
        
        self.game_db = game_db
        self.result = None
        self.selected_suggestion: Optional[Dict[str, Any]] = None
        
        # Center
        self.update_idletasks()
        x = parent.winfo_x() + (parent.winfo_width() - 560) // 2
        y = parent.winfo_y() + (parent.winfo_height() - 620) // 2
        self.geometry(f"+{x}+{y}")
        
        self._build_ui()
    
    def _build_ui(self):
        content = ctk.CTkFrame(self, fg_color="transparent")
        content.pack(fill="both", expand=True, padx=32, pady=24)
        
        content.grid_rowconfigure(0, weight=1)
        content.grid_rowconfigure(1, weight=0)
        content.grid_columnconfigure(0, weight=1)
        
        body = ctk.CTkScrollableFrame(
            content,
            fg_color="transparent",
            corner_radius=0,
            scrollbar_button_color=BRAND_COLORS["border"],
            scrollbar_button_hover_color=BRAND_COLORS["border_hover"]
        )
        body.grid(row=0, column=0, sticky="nsew")
        
        # Header
        ctk.CTkLabel(
            body,
            text="Add Game",
            font=ui_font(size=20, weight="bold"),
            text_color=BRAND_COLORS["text_primary"],
            anchor="w"
        ).pack(fill="x")
        
        ctk.CTkLabel(
            body,
            text="Search our database or add a custom game",
            font=ui_font(size=12),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x", pady=(4, 16))
        
        # Search
        search_frame = ctk.CTkFrame(body, fg_color="transparent")
        search_frame.pack(fill="x")
        
        ctk.CTkLabel(
            search_frame,
            text="Search Games",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x")
        
        self.search_entry = ctk.CTkEntry(
            search_frame,
            height=40,
            placeholder_text="Type to search (e.g., Elden Ring, Dark Souls...)",
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            border_color=BRAND_COLORS["border"],
            border_width=1
        )
        self.search_entry.pack(fill="x", pady=(4, 0))
        self.search_entry.bind("<KeyRelease>", self._on_search)
        
        # Suggestions
        ctk.CTkLabel(
            body,
            text="Suggestions",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x", pady=(16, 4))
        
        self.suggestions_frame = ctk.CTkScrollableFrame(
            body,
            height=120,
            fg_color=BRAND_COLORS["bg_card"],
            corner_radius=8,
            scrollbar_button_color=BRAND_COLORS["border"],
            scrollbar_button_hover_color=BRAND_COLORS["border_hover"]
        )
        self.suggestions_frame.pack(fill="x")
        
        self._populate_suggestions()

        # Custom game CTA
        sep = ctk.CTkFrame(body, height=1, fg_color=BRAND_COLORS["border"])
        sep.pack(fill="x", pady=16)

        cta = ctk.CTkFrame(body, fg_color=BRAND_COLORS["bg_card"], corner_radius=8)
        cta.pack(fill="x")

        cta_inner = ctk.CTkFrame(cta, fg_color="transparent")
        cta_inner.pack(fill="x", padx=16, pady=12)

        ctk.CTkLabel(
            cta_inner,
            text="Can’t find your game?",
            font=ui_font(size=12, weight="bold"),
            text_color=BRAND_COLORS["text_secondary"],
            anchor="w"
        ).pack(fill="x")

        ctk.CTkLabel(
            cta_inner,
            text="Add a custom game with your own save folder path.",
            font=ui_font(size=11),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x", pady=(2, 10))

        ctk.CTkButton(
            cta_inner,
            text="Add Custom Game",
            command=self._open_custom_game_dialog,
            height=32,
            font=ui_font(size=12, weight="bold"),
            fg_color=BRAND_COLORS["accent"],
            hover_color=BRAND_COLORS["accent_hover"],
            corner_radius=6
        ).pack(anchor="w")
        
        # Buttons
        btn_frame = ctk.CTkFrame(content, fg_color="transparent")
        btn_frame.grid(row=1, column=0, sticky="ew", pady=(16, 0))
        
        ctk.CTkButton(
            btn_frame,
            text="Cancel",
            command=self._safe_close,
            width=100,
            height=40,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"]
        ).pack(side="left")
        
        ctk.CTkButton(
            btn_frame,
            text="Add Selected",
            command=self._add_game,
            width=100,
            height=40,
            font=ui_font(size=12, weight="bold"),
            fg_color=BRAND_COLORS["accent"],
            hover_color=BRAND_COLORS["accent_hover"]
        ).pack(side="right")
    
    def _populate_suggestions(self, query: str = ""):
        """Populate suggestions list"""
        for widget in self.suggestions_frame.winfo_children():
            widget.destroy()
        
        games = self.game_db.search_games(query) if query else self.game_db.get_all_games()[:10]
        
        if not games:
            empty = ctk.CTkFrame(self.suggestions_frame, fg_color="transparent")
            empty.pack(fill="x", padx=8, pady=12)
            
            ctk.CTkLabel(
                empty,
                text="No matches found",
                font=ui_font(size=12, weight="bold"),
                text_color=BRAND_COLORS["text_secondary"],
                anchor="w"
            ).pack(fill="x")
            
            ctk.CTkLabel(
                empty,
                text="Use 'Add Custom Game' to add it manually.",
                font=ui_font(size=11),
                text_color=BRAND_COLORS["text_muted"],
                anchor="w"
            ).pack(fill="x", pady=(4, 0))
            return
        
        for game in games[:8]:
            self._create_suggestion_item(game)
    
    def _create_suggestion_item(self, game: Dict[str, Any]):
        """Create a suggestion item"""
        is_selected = (
            self.selected_suggestion and
            self.selected_suggestion.get("id") == game.get("id")
        )
        
        card = ctk.CTkFrame(
            self.suggestions_frame,
            fg_color=BRAND_COLORS["accent_bg"] if is_selected else BRAND_COLORS["bg_card"],
            corner_radius=8,
            border_width=1,
            border_color=BRAND_COLORS["accent"] if is_selected else BRAND_COLORS["border"]
        )
        card.pack(fill="x", padx=4, pady=3)
        
        inner = ctk.CTkFrame(card, fg_color="transparent")
        inner.pack(fill="x", padx=10, pady=8)
        
        name_value = (game.get("name") or "").strip()
        icon_letter = name_value[:1].upper() if name_value else "?"
        icon = ctk.CTkFrame(
            inner,
            width=24,
            height=24,
            fg_color=BRAND_COLORS["accent_bg"] if is_selected else BRAND_COLORS["bg_hover"],
            corner_radius=6
        )
        icon.pack(side="left", padx=(0, 8))
        icon.pack_propagate(False)
        
        icon_label = ctk.CTkLabel(
            icon,
            text=icon_letter,
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_primary"] if is_selected else BRAND_COLORS["text_secondary"]
        )
        icon_label.pack(expand=True)
        
        text_stack = ctk.CTkFrame(inner, fg_color="transparent")
        text_stack.pack(side="left", fill="x", expand=True)
        
        name = ctk.CTkLabel(
            text_stack,
            text=truncate_text(game.get("name", ""), SUGGESTION_GAME_NAME_MAX_CHARS),
            font=ui_font(size=12, weight="bold"),
            text_color=BRAND_COLORS["text_primary"] if is_selected else BRAND_COLORS["text_secondary"],
            anchor="w"
        )
        name.pack(fill="x")
        
        dev = ctk.CTkLabel(
            text_stack,
            text=truncate_text(game.get("developer", ""), SUGGESTION_DEVELOPER_MAX_CHARS),
            font=ui_font(size=10),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        )
        dev.pack(fill="x")
        
        status_dot = ctk.CTkFrame(
            inner,
            width=7,
            height=7,
            corner_radius=4,
            fg_color=BRAND_COLORS["accent"] if is_selected else BRAND_COLORS["border"]
        )
        status_dot.pack(side="right", padx=(8, 0))
        status_dot.pack_propagate(False)
        
        def apply_state(state: str):
            if state == "selected":
                card.configure(
                    fg_color=BRAND_COLORS["accent_bg"],
                    border_color=BRAND_COLORS["accent"]
                )
                icon.configure(fg_color=BRAND_COLORS["accent"])
                icon_label.configure(text_color=BRAND_COLORS["text_primary"])
                name.configure(text_color=BRAND_COLORS["text_primary"])
                dev.configure(text_color=BRAND_COLORS["text_secondary"])
                status_dot.configure(fg_color=BRAND_COLORS["accent"])
            elif state == "hover":
                card.configure(
                    fg_color=BRAND_COLORS["bg_hover"],
                    border_color=BRAND_COLORS["border_hover"]
                )
                icon.configure(fg_color=BRAND_COLORS["border_hover"])
                icon_label.configure(text_color=BRAND_COLORS["text_primary"])
                name.configure(text_color=BRAND_COLORS["text_primary"])
                dev.configure(text_color=BRAND_COLORS["text_muted"])
                status_dot.configure(fg_color=BRAND_COLORS["accent"])
            else:
                card.configure(
                    fg_color=BRAND_COLORS["bg_card"],
                    border_color=BRAND_COLORS["border"]
                )
                icon.configure(fg_color=BRAND_COLORS["bg_hover"])
                icon_label.configure(text_color=BRAND_COLORS["text_secondary"])
                name.configure(text_color=BRAND_COLORS["text_secondary"])
                dev.configure(text_color=BRAND_COLORS["text_muted"])
                status_dot.configure(fg_color=BRAND_COLORS["border"])
        
        apply_state("selected" if is_selected else "normal")
        
        def on_enter(_event):
            if not is_selected:
                apply_state("hover")
        
        def on_leave(_event):
            if not is_selected:
                apply_state("normal")
        
        for widget in [card, inner, icon, icon_label, text_stack, name, dev, status_dot]:
            widget.bind("<Button-1>", lambda e, g=game: self._select_suggestion(g))
            widget.bind("<Enter>", on_enter)
            widget.bind("<Leave>", on_leave)
            widget.configure(cursor="hand2")
    
    def _select_suggestion(self, game: Dict[str, Any]):
        """Select a suggestion"""
        self.selected_suggestion = game
        self._populate_suggestions(self.search_entry.get().strip())
    
    def _on_search(self, event):
        """Handle search input"""
        query = self.search_entry.get().strip()
        if self.selected_suggestion:
            self.selected_suggestion = None
        self._populate_suggestions(query)

    def _open_custom_game_dialog(self):
        dialog = CustomGameDialog(self)
        self.wait_window(dialog)

        if dialog.result:
            self.result = dialog.result
            self._safe_close()
    
    def _add_game(self):
        if not self.selected_suggestion:
            messagebox.showerror(
                "Select a game",
                "Select a game from Suggestions, or click 'Add Custom Game'."
            )
            return

        selected = self.selected_suggestion or {}
        import uuid

        game_id = selected.get("id") or str(uuid.uuid4())[:8]
        name = selected.get("name", "Unknown")
        developer = selected.get("developer", "")
        paths = selected.get("save_paths", [])
        default_save_path = paths[0] if isinstance(paths, list) and paths else ""

        self.result = {
            "id": game_id,
            "name": name,
            "developer": developer,
            "save_path": default_save_path,
        }
        self._safe_close()

    def _safe_close(self):
        safe_close_toplevel(self)


# ==========================================
# CUSTOM GAME DIALOG
# ==========================================
class CustomGameDialog(ctk.CTkToplevel):
    """Dedicated dialog for adding a custom game."""

    def __init__(self, parent):
        super().__init__(parent)

        self.title("Add Custom Game")
        self.geometry("520x420")
        schedule_app_icon(self)
        self.transient(parent)
        self.grab_set()
        self.configure(fg_color=BRAND_COLORS["bg_dark"])
        self.resizable(False, False)
        self.protocol("WM_DELETE_WINDOW", self._safe_close)

        self.result = None

        # Center
        self.update_idletasks()
        x = parent.winfo_x() + (parent.winfo_width() - 520) // 2
        y = parent.winfo_y() + (parent.winfo_height() - 420) // 2
        self.geometry(f"+{x}+{y}")

        self._build_ui()

    def _build_ui(self):
        content = ctk.CTkFrame(self, fg_color="transparent")
        content.pack(fill="both", expand=True, padx=28, pady=24)

        content.grid_rowconfigure(0, weight=1)
        content.grid_rowconfigure(1, weight=0)
        content.grid_columnconfigure(0, weight=1)

        body = ctk.CTkFrame(content, fg_color="transparent")
        body.grid(row=0, column=0, sticky="nsew")

        ctk.CTkLabel(
            body,
            text="Add Custom Game",
            font=ui_font(size=20, weight="bold"),
            text_color=BRAND_COLORS["text_primary"],
            anchor="w",
        ).pack(fill="x")

        ctk.CTkLabel(
            body,
            text="Use this when the game isn’t in suggestions.",
            font=ui_font(size=12),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w",
        ).pack(fill="x", pady=(4, 16))

        # Name
        ctk.CTkLabel(
            body,
            text="Game Name *",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w",
        ).pack(fill="x")

        self.name_entry = ctk.CTkEntry(
            body,
            height=38,
            placeholder_text="e.g., My Indie Game",
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            border_color=BRAND_COLORS["border"],
            border_width=1,
        )
        self.name_entry.pack(fill="x", pady=(4, 12))

        # Developer (optional)
        ctk.CTkLabel(
            body,
            text="Developer (optional)",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w",
        ).pack(fill="x")

        self.developer_entry = ctk.CTkEntry(
            body,
            height=38,
            placeholder_text="e.g., FromSoftware",
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            border_color=BRAND_COLORS["border"],
            border_width=1,
        )
        self.developer_entry.pack(fill="x", pady=(4, 12))

        # Save path
        ctk.CTkLabel(
            body,
            text="Save Folder Path (optional)",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w",
        ).pack(fill="x")

        path_row = ctk.CTkFrame(body, fg_color="transparent")
        path_row.pack(fill="x", pady=(4, 0))

        self.path_entry = ctk.CTkEntry(
            path_row,
            height=38,
            placeholder_text=r"e.g., %APPDATA%\\GameName\\Saves",
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            border_color=BRAND_COLORS["border"],
            border_width=1,
        )
        self.path_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))

        ctk.CTkButton(
            path_row,
            text="Browse",
            command=self._browse_path,
            width=84,
            height=38,
            font=ui_font(size=11),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"],
            corner_radius=6,
        ).pack(side="right")

        ctk.CTkLabel(
            body,
            text="Tip: You can change the save folder later from the game view.",
            font=ui_font(size=11),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w",
        ).pack(fill="x", pady=(10, 0))

        # Buttons
        btn_frame = ctk.CTkFrame(content, fg_color="transparent")
        btn_frame.grid(row=1, column=0, sticky="ew", pady=(18, 0))

        ctk.CTkButton(
            btn_frame,
            text="Cancel",
            command=self._safe_close,
            width=110,
            height=40,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"],
            corner_radius=6,
        ).pack(side="left")

        ctk.CTkButton(
            btn_frame,
            text="Add Custom Game",
            command=self._add_custom_game,
            width=160,
            height=40,
            font=ui_font(size=12, weight="bold"),
            fg_color=BRAND_COLORS["accent"],
            hover_color=BRAND_COLORS["accent_hover"],
            corner_radius=6,
        ).pack(side="right")

        self.name_entry.focus_set()

    def _browse_path(self):
        path = filedialog.askdirectory(title="Select Save Folder")
        if path:
            self.path_entry.delete(0, "end")
            self.path_entry.insert(0, path)

    def _add_custom_game(self):
        name = self.name_entry.get().strip()
        if not name:
            messagebox.showerror("Required", "Please enter a game name.")
            return

        developer = self.developer_entry.get().strip()
        save_path = self.path_entry.get().strip()

        import uuid
        self.result = {
            "id": str(uuid.uuid4())[:8],
            "name": name,
            "developer": developer,
            "save_path": save_path,
        }
        self._safe_close()

    def _safe_close(self):
        safe_close_toplevel(self)


# ==========================================
# SETTINGS DIALOG
# ==========================================
class SettingsDialog(ctk.CTkToplevel):
    """Settings dialog"""
    
    def __init__(self, parent, config: Dict[str, Any]):
        super().__init__(parent)
        
        self.title("Settings")
        self.geometry("480x320")
        schedule_app_icon(self)
        self.transient(parent)
        self.grab_set()
        self.configure(fg_color=BRAND_COLORS["bg_dark"])
        self.resizable(False, False)
        self.protocol("WM_DELETE_WINDOW", self._safe_close)
        
        self.config = config.copy()
        self.result = None
        
        # Center
        self.update_idletasks()
        x = parent.winfo_x() + (parent.winfo_width() - 480) // 2
        y = parent.winfo_y() + (parent.winfo_height() - 320) // 2
        self.geometry(f"+{x}+{y}")
        
        self._build_ui()
    
    def _build_ui(self):
        content = ctk.CTkFrame(self, fg_color="transparent")
        content.pack(fill="both", expand=True, padx=32, pady=24)
        
        content.grid_rowconfigure(0, weight=1)
        content.grid_rowconfigure(1, weight=0)
        content.grid_columnconfigure(0, weight=1)
        
        body = ctk.CTkFrame(content, fg_color="transparent")
        body.grid(row=0, column=0, sticky="nsew")
        
        # Header
        ctk.CTkLabel(
            body,
            text="Settings",
            font=ui_font(size=20, weight="bold"),
            text_color=BRAND_COLORS["text_primary"],
            anchor="w"
        ).pack(fill="x", pady=(0, 20))
        
        # Backup directory
        dir_frame = ctk.CTkFrame(body, fg_color="transparent")
        dir_frame.pack(fill="x")
        
        ctk.CTkLabel(
            dir_frame,
            text="Backup Directory",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x")
        
        path_row = ctk.CTkFrame(dir_frame, fg_color="transparent")
        path_row.pack(fill="x", pady=(4, 0))
        
        self.dir_entry = ctk.CTkEntry(
            path_row,
            height=40,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_card"],
            border_color=BRAND_COLORS["border"],
            border_width=1
        )
        self.dir_entry.insert(0, self.config.get("backup_directory", ""))
        self.dir_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))
        
        ctk.CTkButton(
            path_row,
            text="Browse",
            command=self._browse_dir,
            width=80,
            height=40,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"]
        ).pack(side="right")
        
        # Max backups
        max_frame = ctk.CTkFrame(body, fg_color="transparent")
        max_frame.pack(fill="x", pady=(20, 0))
        
        ctk.CTkLabel(
            max_frame,
            text="Maximum Backups per Game",
            font=ui_font(size=11, weight="bold"),
            text_color=BRAND_COLORS["text_muted"],
            anchor="w"
        ).pack(fill="x")
        
        slider_row = ctk.CTkFrame(max_frame, fg_color="transparent")
        slider_row.pack(fill="x", pady=(8, 0))
        
        self.max_var = ctk.IntVar(value=self.config.get("max_backups", 10))
        
        self.max_slider = ctk.CTkSlider(
            slider_row,
            from_=1,
            to=50,
            number_of_steps=49,
            variable=self.max_var,
            command=self._on_slider,
            progress_color=BRAND_COLORS["accent"],
            button_color=BRAND_COLORS["accent"],
            button_hover_color=BRAND_COLORS["accent_hover"]
        )
        self.max_slider.pack(side="left", fill="x", expand=True, padx=(0, 16))
        
        self.max_label = ctk.CTkLabel(
            slider_row,
            text=f"{self.max_var.get()} backups",
            font=ui_font(size=12),
            text_color=BRAND_COLORS["text_secondary"],
            width=80
        )
        self.max_label.pack(side="right")
        
        # Buttons
        btn_frame = ctk.CTkFrame(content, fg_color="transparent")
        btn_frame.grid(row=1, column=0, sticky="ew")
        
        ctk.CTkButton(
            btn_frame,
            text="Cancel",
            command=self._safe_close,
            width=100,
            height=40,
            font=ui_font(size=12),
            fg_color=BRAND_COLORS["bg_hover"],
            hover_color=BRAND_COLORS["border_hover"]
        ).pack(side="left")
        
        ctk.CTkButton(
            btn_frame,
            text="Save",
            command=self._save,
            width=100,
            height=40,
            font=ui_font(size=12, weight="bold"),
            fg_color=BRAND_COLORS["accent"],
            hover_color=BRAND_COLORS["accent_hover"]
        ).pack(side="right")
    
    def _browse_dir(self):
        path = filedialog.askdirectory(title="Select Backup Directory")
        if path:
            self.dir_entry.delete(0, "end")
            self.dir_entry.insert(0, path)
    
    def _on_slider(self, value):
        self.max_label.configure(text=f"{int(value)} backups")
    
    def _save(self):
        backup_dir = self.dir_entry.get().strip()
        
        if not backup_dir:
            messagebox.showerror("Required", "Please select a backup directory.")
            return
        
        self.config["backup_directory"] = backup_dir
        self.config["max_backups"] = self.max_var.get()
        self.result = self.config
        self._safe_close()

    def _safe_close(self):
        safe_close_toplevel(self)
