"""Check artwork provenance and adaptive mask safety; write a visual QA sheet."""
from pathlib import Path
import hashlib
import json
import math
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "src-tauri/gen/android/app/src/main/res"
SOURCE = ROOT / "design/app-icons/yukino"
OUTPUT = Path("D:/DevTools/Android/Build/qa/app-icons-20261017")
OUTPUT.mkdir(parents=True, exist_ok=True)
records = json.loads((SOURCE / "resources.json").read_text())
android = "{http://schemas.android.com/apk/res/android}"
application = ET.parse(RES.parent / "AndroidManifest.xml").getroot().find("application")
aliases = application.findall("activity-alias")
assert len(aliases) == 3
assert [alias.get(android + "name") for alias in aliases if alias.get(android + "enabled") == "true"] == ["com.genzo.android.LauncherClassic"]
assert all(alias.get(android + "targetActivity") == ".MainActivity" for alias in aliases)
sheet = Image.new("RGB", (576, 384), "#dce4e8")
for column, key in enumerate(("classic", "beret", "winter")):
    assert hashlib.sha256((SOURCE / f"{key}.png").read_bytes()).hexdigest() == records[key]["sourceSha256"]
    image = Image.open(RES / f"drawable-nodpi/genzo_icon_{key}.png").convert("RGB")
    assert image.size == (432, 432)
    for y in range(432):
        for x in range(432):
            if min(image.getpixel((x, y))) < 225:
                assert math.hypot(x + .5 - 216, y + .5 - 216) < 132, (key, x, y)
    name = "ic_launcher" if key == "classic" else f"ic_launcher_{key}"
    xml = ET.parse(RES / f"mipmap-anydpi-v26/{name}.xml").getroot()
    assert xml.tag == "adaptive-icon"
    for row, shape in enumerate(("circle", "rounded")):
        visible = image.crop((72, 72, 360, 360)).resize((160, 160), Image.Resampling.LANCZOS)
        mask = Image.new("L", visible.size)
        painter = ImageDraw.Draw(mask)
        if shape == "circle":
            painter.ellipse((0, 0, 159, 159), fill=255)
        else:
            painter.rounded_rectangle((0, 0, 159, 159), radius=36, fill=255)
        sheet.paste(visible, (column * 192 + 16, row * 192 + 16), mask)
sheet.save(OUTPUT / "icon-masks.png")
print("Three original hashes, adaptive resources and 66dp safe circles verified.")
