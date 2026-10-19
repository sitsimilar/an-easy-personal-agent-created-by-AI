# -*- coding: utf-8 -*-
"""生成「个人信息管家」应用图标：build/icon.png (256) + build/icon.ico (多尺寸)"""
import math, os
from PIL import Image, ImageDraw

SS = 1024          # 超采样尺寸，保证边缘平滑
PNG_SIZE = 256     # 托盘用 PNG
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'build')


def sparkle(draw, cx, cy, R, r, fill, rot=0.0):
    """绘制四角星（AI 火花），rot 弧度旋转。"""
    pts = []
    for i in range(8):
        ang = math.radians(i * 45) + rot
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    draw.polygon(pts, fill=fill)


def make():
    # 渐变背景（靛蓝 -> 蓝）
    top, bottom = (99, 102, 241), (37, 99, 235)
    grad = Image.new('RGBA', (SS, SS))
    gd = ImageDraw.Draw(grad)
    for y in range(SS):
        t = y / (SS - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        gd.line([(0, y), (SS, y)], fill=c + (255,))

    mask = Image.new('L', (SS, SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SS - 1, SS - 1],
                                           radius=int(SS * 0.22), fill=255)
    img = Image.new('RGBA', (SS, SS), (0, 0, 0, 0))
    img = Image.composite(grad, img, mask)
    d = ImageDraw.Draw(img)

    # 主火花
    sparkle(d, SS * 0.5, SS * 0.50, SS * 0.30, SS * 0.115, (255, 255, 255, 255))
    # 右上小火花点缀
    sparkle(d, SS * 0.74, SS * 0.26, SS * 0.075, SS * 0.030,
            (255, 255, 255, 235), rot=math.radians(15))
    # 左下小圆点
    d.ellipse([SS * 0.23 - SS * 0.02, SS * 0.78 - SS * 0.02,
               SS * 0.23 + SS * 0.02, SS * 0.78 + SS * 0.02],
              fill=(255, 255, 255, 200))

    os.makedirs(OUT_DIR, exist_ok=True)
    img.resize((PNG_SIZE, PNG_SIZE), Image.LANCZOS).save(
        os.path.join(OUT_DIR, 'icon.png'))
    img.resize((256, 256), Image.LANCZOS).save(
        os.path.join(OUT_DIR, 'icon.ico'), format='ICO',
        sizes=[(s, s) for s in ICO_SIZES])
    print('OK: icon.png + icon.ico 已生成于', OUT_DIR)


if __name__ == '__main__':
    make()
