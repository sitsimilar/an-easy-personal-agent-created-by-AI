# -*- coding: utf-8 -*-
"""
应用图标美化：以用户提供的雕像图片为基底，叠加设计元素使其更完整。
设计思路：
  1. 雕像照片（居中裁方）作为主体 —— 代表「管家/助手」人格；
  2. 靛蓝色圆角边框 —— 与应用主题色（#4F46E5）统一；
  3. 右下角代码符号徽章（</>）—— 呼应「代码分析助手」的核心功能；
  4. 圆角矩形轮廓 —— 与 UI 圆角卡片风格统一。
"""
import math
import os
from PIL import Image, ImageDraw

SRC = r'C:\Users\lenovo\.workbuddy\clipboard-images\clipboard-2026-10-11T15-35-09-556Z-24b8555e.png'
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'build')

SS = 1024      # 超采样
FINAL = 256    # 最终尺寸
THEME = (79, 70, 229)       # 靛蓝 #4F46E5
THEME_DARK = (55, 48, 163)  # 深靛蓝 #3730A3
WHITE = (255, 255, 255)


def draw_code_symbol(draw, cx, cy, r, color, width):
    """绘制 </> 代码符号（三条白色笔画）。"""
    h = r * 0.6      # 符号高度的一半
    w = r * 0.45     # 每个尖角的水平偏移
    gap = r * 0.18   # < 与 > 距中心的水平距离
    lw = width

    # < （左侧尖角）
    draw.line([(cx - gap - w, cy - h), (cx - gap, cy), (cx - gap - w, cy + h)],
              fill=color, width=lw, joint='curve')
    # / （中间斜杠）
    draw.line([(cx - r * 0.06, cy + h * 1.1), (cx + r * 0.06, cy - h * 1.1)],
              fill=color, width=lw)
    # > （右侧尖角）
    draw.line([(cx + gap + w, cy - h), (cx + gap, cy), (cx + gap + w, cy + h)],
              fill=color, width=lw, joint='curve')


def make():
    src = Image.open(SRC).convert('RGB')
    w, h = src.size
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    img = src.crop((left, top, left + s, top + s)).resize((SS, SS), Image.LANCZOS)

    # 圆角轮廓
    mask = Image.new('L', (SS, SS), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, SS - 1, SS - 1], radius=int(SS * 0.16), fill=255)

    # 靛蓝描边（宽约 SS*0.02，绘制在轮廓外沿）
    border_img = Image.new('RGBA', (SS, SS), (0, 0, 0, 0))
    bd = ImageDraw.Draw(border_img)
    bd.rounded_rectangle(
        [0, 0, SS - 1, SS - 1], radius=int(SS * 0.16),
        outline=THEME + (255,), width=int(SS * 0.018),
    )

    out = Image.new('RGBA', (SS, SS), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    out.alpha_composite(border_img)

    # 右下角代码符号徽章（靛蓝圆 + 白色 </>）
    badge_r = int(SS * 0.16)
    bx = SS - badge_r - int(SS * 0.06)
    by = SS - badge_r - int(SS * 0.06)
    # 徽章外圈（白色描边，与底图分隔）
    d2 = ImageDraw.Draw(out)
    d2.ellipse(
        [bx - badge_r - int(SS * 0.008), by - badge_r - int(SS * 0.008),
         bx + badge_r + int(SS * 0.008), by + badge_r + int(SS * 0.008)],
        fill=WHITE + (255,),
    )
    d2.ellipse(
        [bx - badge_r, by - badge_r, bx + badge_r, by + badge_r],
        fill=THEME + (255,),
    )
    # </> 符号（白色笔画）
    draw_code_symbol(d2, bx, by, badge_r * 0.72, WHITE + (255,), max(3, int(SS * 0.006)))

    os.makedirs(OUT, exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    final = out.resize((FINAL, FINAL), Image.LANCZOS)
    final.save(os.path.join(OUT, 'icon.png'))
    final.save(os.path.join(OUT, 'icon.ico'), format='ICO', sizes=[(x, x) for x in sizes])
    print('OK 图标已重新设计并生成')


if __name__ == '__main__':
    make()
