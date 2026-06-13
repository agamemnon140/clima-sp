"""Gera os ícones PNG do clima-sp a partir do desenho do logo.

Executar uma única vez localmente (dependência só de dev):
    pip install pillow
    py scripts/gerar_logo.py

Não faz parte do pipeline mensal — os PNGs ficam commitados em docs/icons/.
"""
from pathlib import Path

from PIL import Image, ImageDraw

DOCS = Path(__file__).resolve().parents[1] / "docs"
ICONS = DOCS / "icons"

CEU_TOPO = (28, 93, 153)
CEU_BASE = (18, 60, 99)
SOL = (240, 160, 70)
SOL_CLARO = (255, 207, 107)
BRANCO = (255, 255, 255)
GOTA = (126, 200, 255)


def _gradiente_vertical(size, topo, base):
    img = Image.new("RGB", (1, size), 0)
    for y in range(size):
        t = y / (size - 1)
        img.putpixel((0, y), tuple(round(topo[i] + (base[i] - topo[i]) * t) for i in range(3)))
    return img.resize((size, size))


def desenhar(size: int) -> Image.Image:
    # supersampling 4x para bordas suaves
    s = size * 4
    base = _gradiente_vertical(s, CEU_TOPO, CEU_BASE).convert("RGBA")

    # canto arredondado
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.21), fill=255)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    img.paste(base, (0, 0), mask)
    d = ImageDraw.Draw(img)

    def px(v):
        return int(v / 512 * s)

    # raios do sol
    for x1, y1, x2, y2 in [(200, 74, 200, 104), (106, 196, 76, 196), (124, 120, 103, 99),
                            (276, 120, 297, 99), (124, 272, 103, 293)]:
        d.line([px(x1), px(y1), px(x2), px(y2)], fill=SOL_CLARO, width=px(14))
    # sol
    d.ellipse([px(126), px(122), px(274), px(270)], fill=SOL)
    # nuvem
    for cx, cy, r in [(248, 296, 58), (312, 272, 74), (372, 312, 54)]:
        d.ellipse([px(cx - r), px(cy - r), px(cx + r), px(cy + r)], fill=BRANCO)
    d.rounded_rectangle([px(248), px(300), px(376), px(364)], radius=px(32), fill=BRANCO)
    # gotas
    for cx in (236, 300, 364):
        d.ellipse([px(cx - 19), px(396), px(cx + 19), px(434)], fill=GOTA)
        d.polygon([(px(cx - 14), px(400)), (px(cx + 14), px(400)), (px(cx), px(376))], fill=GOTA)

    return img.resize((size, size), Image.LANCZOS)


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    desenhar(180).save(ICONS / "apple-touch-icon.png")
    desenhar(512).save(ICONS / "icon-512.png")
    desenhar(192).save(ICONS / "icon-192.png")
    desenhar(32).save(DOCS / "favicon.png")
    print("icones gerados em docs/icons/ e docs/favicon.png")


if __name__ == "__main__":
    main()
