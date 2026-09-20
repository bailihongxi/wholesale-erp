#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成应用在桌面上的默认图标（第十六轮）。

为什么要有这个文件：
  电脑端 Chrome / Edge 与安卓手机把网页「发送到桌面」时，会去读 manifest 里的
  192 / 512 尺寸的 PNG。仓库里原本一张图都没有，安装出来的快捷方式是个灰白默认方块。
  这里用纯标准库（zlib + struct）手写 PNG，不依赖 Pillow，任何人 checkout 后都能复现。

图标设计（512 基准，其余尺寸等比缩放）：
  品牌蓝渐变底 + 白色纸箱轮廓 —— 对应「家电批发 · 进销存」的业务含义。
  maskable 版本四周留 20% 安全边，避免安卓把图标裁成圆形时边角被切掉。

用法：python3 scripts/gen-icons.py
"""
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'icons')

# 品牌色：顶 #16325c → 底 #2f6bff（与 theme.css 的主色一致）
BG_TOP = (22, 50, 92)
BG_BOTTOM = (47, 107, 255)
GLYPH = (255, 255, 255)


def write_png(path: str, w: int, h: int, rgba: bytearray) -> None:
    """把 RGBA 原始数据写成 PNG（truecolor + alpha，8bit）"""
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        raw += rgba[y * w * 4:(y + 1) * w * 4]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def blend(buf, w, h, x, y, color, a=1.0):
    """单点 alpha 混合"""
    if not (0 <= x < w and 0 <= y < h) or a <= 0:
        return
    i = (y * w + x) * 4
    if a >= 1:
        buf[i:i + 3] = bytes(color)
        buf[i + 3] = 255
        return
    for c in range(3):
        buf[i + c] = int(buf[i + c] * (1 - a) + color[c] * a)
    buf[i + 3] = int(buf[i + 3] * (1 - a) + 255 * a)


def in_rounded(x, y, x0, y0, x1, y1, r):
    """点是否落在圆角矩形内"""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    if r <= 0:
        return True
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def fill_rounded(buf, w, h, x0, y0, x1, y1, r, color):
    for y in range(max(0, int(y0) - 1), min(h, int(y1) + 2)):
        for x in range(max(0, int(x0) - 1), min(w, int(x1) + 2)):
            if in_rounded(x, y, x0, y0, x1, y1, r):
                blend(buf, w, h, x, y, color)


def gradient_bg(buf, size):
    """先铺满竖向渐变底，再在上面画图形"""
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(int(BG_TOP[c] + (BG_BOTTOM[c] - BG_TOP[c]) * t) for c in range(3))
        for x in range(size):
            buf.extend(bytes(color) + b'\xff')


def draw_icon(size: int, maskable: bool = False) -> bytearray:
    """绘制一张图标，返回 RGBA 数据"""
    buf = bytearray()
    gradient_bg(buf, size)

    # maskable：内容缩进到中间的 80%，四周留白给系统遮罩裁剪
    pad = size * 0.20 if maskable else size * 0.10
    inner = size - pad * 2
    s = inner / 512.0  # 以 512 设计稿为基准缩放

    def P(v):  # 设计稿坐标 → 实际像素
        return pad + v * s

    # 纸箱盖子（实心圆角矩形）
    fill_rounded(buf, size, size,
                 P(96), P(140), P(416), P(212), 26 * s, GLYPH)
    # 箱体边框：外框白 + 内部掏空，形成描边效果
    fill_rounded(buf, size, size,
                 P(96), P(196), P(416), P(420), 26 * s, GLYPH)
    hollow_top = BG_TOP  # 内部用底色回填（近似即可，肉眼无差别）
    hollow_bottom = BG_BOTTOM
    for y in range(int(P(196)) + 1, int(P(420))):
        t = y / size
        color = tuple(int(hollow_top[c] + (hollow_bottom[c] - hollow_top[c]) * t) for c in range(3))
        for x in range(int(P(96)) + 1, int(P(416))):
            if in_rounded(x, y, P(96) + 30 * s, P(196) + 30 * s, P(416) - 30 * s, P(420) - 30 * s, 14 * s):
                blend(buf, size, size, x, y, color)
    # 封箱胶带（居中竖条）
    fill_rounded(buf, size, size,
                 P(238), P(140), P(274), P(420), 6 * s, GLYPH)

    # 圆角裁切：让整张图变成圆角方形（安卓自适应图标与 Windows 磁贴更好看）
    corner = size * (0 if maskable else 0.18)
    if corner > 0:
        for y in range(size):
            for x in range(size):
                if not in_rounded(x, y, 0, 0, size - 1, size - 1, corner):
                    i = (y * size + x) * 4
                    buf[i + 3] = 0
    return buf


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    targets = [
        ('icon-192.png', 192, False),
        ('icon-512.png', 512, False),
        ('icon-maskable-512.png', 512, True),
        ('apple-touch-icon.png', 180, False),
        ('favicon-32.png', 32, False),
    ]
    for name, size, maskable in targets:
        data = draw_icon(size, maskable)
        path = os.path.join(OUT_DIR, name)
        write_png(path, size, size, data)
        print(f'已生成 {name}  {size}x{size}  ({os.path.getsize(path) / 1024:.1f} KB)')


if __name__ == '__main__':
    main()
