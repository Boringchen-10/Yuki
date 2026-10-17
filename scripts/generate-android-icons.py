"""Package the approved PNG artwork without redrawing it. Requires Pillow."""
from pathlib import Path
import hashlib
import json
import math
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "src-tauri/gen/android/app/src/main/res"
SOURCES = ROOT / "design/app-icons/yukino"


def generate():
    manifest = {}
    for key in ("classic", "beret", "winter"):
        source = SOURCES / f"{key}.png"
        image = Image.open(source).convert("RGB")
        assert image.width == image.height
        # Fit all non-white artwork inside a 64dp circle within the 66dp safe zone.
        extent = max(math.hypot(x + .5 - image.width / 2, y + .5 - image.height / 2)
                     for y in range(image.height) for x in range(image.width)
                     if min(image.getpixel((x, y))) < 235)
        scale = 128 / extent  # 4 pixels per dp; 32dp radius.
        size = round(image.width * scale)
        foreground = Image.new("RGB", (432, 432), "white")
        foreground.paste(image.resize((size, size), Image.Resampling.LANCZOS),
                         ((432 - size) // 2, (432 - size) // 2))
        drawable = RES / "drawable-nodpi"
        drawable.mkdir(exist_ok=True)
        foreground.save(drawable / f"genzo_icon_{key}.png", optimize=True)
        name = "ic_launcher" if key == "classic" else f"ic_launcher_{key}"
        adaptive = RES / "mipmap-anydpi-v26"
        adaptive.mkdir(exist_ok=True)
        (adaptive / f"{name}.xml").write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@android:color/white" />\n'
            f'    <foreground android:drawable="@drawable/genzo_icon_{key}" />\n'
            '</adaptive-icon>\n', encoding="utf-8")
        visible = foreground.crop((72, 72, 360, 360))
        for density, pixels in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
            folder = RES / f"mipmap-{density}"
            folder.mkdir(exist_ok=True)
            visible.resize((pixels, pixels), Image.Resampling.LANCZOS).save(folder / f"{name}.png", optimize=True)
        preview = ROOT / "src/android/assets/app-icons"
        preview.mkdir(parents=True, exist_ok=True)
        visible.resize((256, 256), Image.Resampling.LANCZOS).save(preview / f"{key}.png", optimize=True)
        manifest[key] = {"sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                         "foregroundPixels": 432, "artworkMaxRadiusDp": 32}
    (SOURCES / "resources.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    generate()
