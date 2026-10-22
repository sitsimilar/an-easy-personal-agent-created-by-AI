# -*- coding: utf-8 -*-
"""个人信息管家 · 应用图标生成器（品牌标 C「切分」）
=====================================================
生成 `build/icon.ico`（多尺寸）与 `build/icon.png`（256）。

**这是打包链唯一依赖的图标脚本，必须自包含**——不能 import 宣传片目录里的
`build_logo_c.py`，否则打包机拿不到那份源码。下面的几何常量与
`promo-runs/2026-10-21-personal-agent/assets/logo/c/build_logo_c.py` 同源，
改一处必须同步另一处。

品牌标 C「切分」：一块靛蓝实心圆角方 + 一道渐细的白色斜槽贯穿。
槽 = 把它分开的那一刀——**切分，但不断裂**。整理信息本就该如此：分类不是打碎。

规格
----
底    #5B54D9（= web/src/theme.ts 的 primary.main），圆角 22.4%，出血铺满画布
槽    白色，渐细 3.3:1（起手 25°、收尾 48°），两端穿出画布，与外形咬合
≤32px 走 compact 几何：槽加宽、弧度压平，否则斜槽会被抗锯齿抹淡、辨识不清

用法
----
    python scripts/make-icon.py
"""
import io
import os
import struct
import numpy as np
from PIL import Image, ImageDraw

# ---------------------------------------------------------------- 几何（viewBox 0 0 100 100）
VB = 100.0
# 图标专用槽（出血底上贯穿的负空间切口，与 build_logo_c.py 的 ICON_GEOM 一致）
ICON_SLOT = dict(
    spine=((-7.0, 92.0), (31.0, 80.0), (76.0, 44.0), (107.0, 18.0)),
    w0=7.8, w1=2.2,
)
# ≤32px 专用：槽加宽、弧度压平，保证小尺寸下切口仍清晰
ICON_SLOT_C = dict(
    spine=((-7.0, 90.0), (33.0, 78.0), (76.0, 45.0), (107.0, 22.0)),
    w0=11.0, w1=5.5,
)

# ---------------------------------------------------------------- 规格
BRAND = "#5B54D9"
RADIUS = 0.224
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'build')


def _bez(p0, c1, c2, p3, n=300):
    t = np.linspace(0.0, 1.0, n)[:, None]
    mt = 1.0 - t
    return (mt ** 3 * np.array(p0) + 3 * mt ** 2 * t * np.array(c1)
            + 3 * mt * t ** 2 * np.array(c2) + t ** 3 * np.array(p3))


def _band(spine, w0, w1):
    """沿 spine 的渐窄带（法线对称）。"""
    d = np.gradient(spine, axis=0)
    dn = d / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    nrm = np.stack([-dn[:, 1], dn[:, 0]], axis=1)
    w = np.linspace(w0, w1, len(spine)) / 2.0
    return np.vstack([spine + nrm * w[:, None], (spine - nrm * w[:, None])[::-1]])


def _slot_geom(px):
    return ICON_SLOT_C if px <= 32 else ICON_SLOT


def _hex2rgba(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def render(px):
    """px×px 的 RGBA 图标：靛蓝圆角方出血 + 白色渐细槽贯穿。"""
    ss = 6 if px >= 128 else 12
    S = int(px * ss)
    k = S / VB
    slot = _slot_geom(px)

    canvas = Image.new("RGBA", (S, S), _hex2rgba(BRAND))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, S - 1, S - 1], radius=RADIUS * S, fill=255)
    canvas.putalpha(mask)

    cut = Image.new("L", (S, S), 0)
    sp = _bez(*slot["spine"])
    ImageDraw.Draw(cut).polygon(
        [(float(x) * k, float(y) * k) for x, y in _band(sp, slot["w0"], slot["w1"])],
        fill=255)
    white = Image.new("RGBA", (S, S), (255, 255, 255, 255))
    white.putalpha(cut)
    canvas.alpha_composite(white)
    return canvas.resize((px, px), Image.LANCZOS)


# ---------------------------------------------------------------- ICO
def _bmp_entry(img):
    """32bpp BGRA DIB + 1bpp AND mask。小尺寸用它，老工具兼容性最好。"""
    w, h = img.size
    arr = np.asarray(img.convert("RGBA"), np.uint8)
    xor = arr[:, :, [2, 1, 0, 3]][::-1].tobytes()          # BGRA, bottom-up

    stride = ((w + 31) // 32) * 4
    and_mask = np.zeros((h, stride), np.uint8)
    alpha = arr[::-1, :, 3]
    for y in range(h):
        row = alpha[y]
        for x in range(w):
            if row[x] == 0:
                and_mask[y, x >> 3] |= (0x80 >> (x & 7))
    and_bytes = and_mask.tobytes()

    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0,
                         len(xor) + len(and_bytes), 0, 0, 0, 0)
    return header + xor + and_bytes


def _png_entry(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_ico(path, sizes):
    payloads = [(s, (_png_entry(render(s)) if s >= 128 else _bmp_entry(render(s))))
                for s in sizes]
    n = len(payloads)
    offset = 6 + 16 * n
    table, blobs = b"", b""
    for s, data in payloads:
        w = 0 if s >= 256 else s
        table += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    with open(path, "wb") as f:
        f.write(struct.pack("<HHH", 0, 1, n) + table + blobs)


def make():
    os.makedirs(OUT_DIR, exist_ok=True)
    png = os.path.join(OUT_DIR, "icon.png")
    ico = os.path.join(OUT_DIR, "icon.ico")
    render(256).save(png, "PNG")
    write_ico(ico, ICO_SIZES)
    print(f"OK  {png}")
    print(f"OK  {ico}  ({os.path.getsize(ico) // 1024} KB, sizes={ICO_SIZES})")


if __name__ == "__main__":
    make()
