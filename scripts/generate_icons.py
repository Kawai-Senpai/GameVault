"""
GameVault Icon Generator
========================
Generates all required icons for Tauri (Windows, macOS, Linux) from the source logo.

Source: assets/game_vault_icon.png
Output: src-tauri/icons/

Required icons for Tauri:
  - 32x32.png       (taskbar, small UI)
  - 128x128.png     (app icon, about dialog)
  - 128x128@2x.png  (256x256, HiDPI displays)
  - icon.ico         (Windows executable icon, multi-resolution)
  - icon.icns        (macOS app bundle icon)
  - icon.png         (512x512 master, used as default window icon)

Also generates:
  - public/favicon.ico (16x16 + 32x32 multi-res for web)
  - public/icon-192.png (PWA manifest)
  - public/icon-512.png (PWA manifest)

Usage:
  python scripts/generate_icons.py
  
Requirements:
  pip install Pillow
"""

import os
import struct
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required. Install with: pip install Pillow")
    sys.exit(1)


# ─── Paths ───────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "game_vault_icon.png"
TAURI_ICONS = ROOT / "src-tauri" / "icons"
PUBLIC = ROOT / "public"


def ensure_dirs():
    """Create output directories if they don't exist."""
    TAURI_ICONS.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)


def load_source() -> Image.Image:
    """Load and validate the source icon."""
    if not SOURCE.exists():
        print(f"ERROR: Source icon not found at {SOURCE}")
        sys.exit(1)

    img = Image.open(SOURCE).convert("RGBA")
    print(f"[OK] Loaded source: {img.size[0]}x{img.size[1]} ({img.mode})")

    # Pad to square if needed
    w, h = img.size
    if w != h:
        size = max(w, h)
        square = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        offset = ((size - w) // 2, (size - h) // 2)
        square.paste(img, offset, img)
        img = square
        print(f"[OK] Padded to square: {size}x{size}")

    return img


def resize(img: Image.Image, size: int) -> Image.Image:
    """High-quality resize to target size."""
    return img.resize((size, size), Image.Resampling.LANCZOS)


def generate_png(img: Image.Image, size: int, path: Path, label: str):
    """Generate a PNG icon at the given size."""
    resized = resize(img, size)
    resized.save(str(path), "PNG", optimize=True)
    file_size = path.stat().st_size
    print(f"  [+] {label}: {size}x{size} ({file_size:,} bytes) -> {path.name}")


def generate_ico(img: Image.Image, path: Path, sizes: list[int], label: str):
    """Generate a Windows .ico file with multiple resolutions."""
    # For ICO, we save the largest size and specify all target sizes
    # Pillow handles the multi-resolution encoding internally
    largest = max(sizes)
    resized = resize(img, largest)
    resized.save(
        str(path),
        format="ICO",
        sizes=[(s, s) for s in sorted(sizes)],
    )
    file_size = path.stat().st_size
    print(f"  [+] {label}: {sizes} ({file_size:,} bytes) -> {path.name}")


def generate_icns(img: Image.Image, path: Path):
    """
    Generate a macOS .icns file.
    Uses Pillow's ICNS support if available, otherwise creates a minimal valid icns.
    """
    try:
        # Pillow supports ICNS on macOS natively, and on other platforms
        # with the 'icnsutil' or via direct write
        resized = resize(img, 512)
        resized.save(str(path), format="ICNS")
        file_size = path.stat().st_size
        print(f"  [+] macOS icon: 512x512 ({file_size:,} bytes) -> {path.name}")
    except Exception:
        # Fallback: create a minimal ICNS with ic09 (512x512 JPEG2000) replaced by PNG
        # macOS accepts PNG data in icns icon types
        png_data_256 = _get_png_bytes(resize(img, 256))
        png_data_512 = _get_png_bytes(resize(img, 512))

        entries = []
        # ic08 = 256x256 PNG
        entries.append((b"ic08", png_data_256))
        # ic09 = 512x512 PNG  
        entries.append((b"ic09", png_data_512))

        # Build ICNS file
        body = b""
        for icon_type, data in entries:
            entry_size = 8 + len(data)
            body += icon_type + struct.pack(">I", entry_size) + data

        total_size = 8 + len(body)
        icns_data = b"icns" + struct.pack(">I", total_size) + body

        path.write_bytes(icns_data)
        file_size = path.stat().st_size
        print(f"  [+] macOS icon (manual): 256+512 ({file_size:,} bytes) -> {path.name}")


def _get_png_bytes(img: Image.Image) -> bytes:
    """Get PNG bytes from a PIL Image."""
    import io
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def main():
    print("=" * 50)
    print("  GameVault Icon Generator")
    print("=" * 50)
    print()

    ensure_dirs()
    img = load_source()
    print()

    # ── Tauri Icons ──────────────────────────────
    print("Generating Tauri icons...")

    generate_png(img, 32, TAURI_ICONS / "32x32.png", "Small icon")
    generate_png(img, 128, TAURI_ICONS / "128x128.png", "Standard icon")
    generate_png(img, 256, TAURI_ICONS / "128x128@2x.png", "HiDPI icon")
    generate_png(img, 512, TAURI_ICONS / "icon.png", "Master icon")

    generate_ico(
        img,
        TAURI_ICONS / "icon.ico",
        [16, 24, 32, 48, 64, 128, 256],
        "Windows ICO",
    )

    generate_icns(img, TAURI_ICONS / "icon.icns")
    print()

    # ── Web / PWA Icons ──────────────────────────
    print("Generating web icons...")

    generate_ico(img, PUBLIC / "favicon.ico", [16, 32], "Favicon")
    generate_png(img, 192, PUBLIC / "icon-192.png", "PWA small")
    generate_png(img, 512, PUBLIC / "icon-512.png", "PWA large")
    print()

    print("=" * 50)
    print(f"  Done! All icons generated from {SOURCE.name}")
    print("=" * 50)


if __name__ == "__main__":
    main()
