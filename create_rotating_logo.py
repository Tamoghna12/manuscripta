#!/usr/bin/env python3
from PIL import Image

# 读取原始 logo
logo = Image.open('/data/users/liuzhou/online/OpenPrism/static/logo.png')

# 转换为 RGBA 模式以支持透明度
if logo.mode != 'RGBA':
    logo = logo.convert('RGBA')

# 创建旋转帧列表
frames = []
num_frames = 36  # 36 帧，每帧旋转 10 度

for i in range(num_frames):
    angle = i * (360 / num_frames)
    # 旋转图片，使用 expand=True 保持完整图像
    rotated = logo.rotate(-angle, resample=Image.BICUBIC, expand=False)
    frames.append(rotated)

# 保存为 GIF
output_path = '/data/users/liuzhou/online/OpenPrism/static/logo-rotating.gif'
frames[0].save(
    output_path,
    save_all=True,
    append_images=frames[1:],
    duration=50,  # 每帧 50ms
    loop=0,  # 无限循环
    optimize=True
)

print(f"旋转动画已创建: {output_path}")
