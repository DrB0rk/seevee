"""Regenerate the Seevee brand assets.

Requires Python fonttools, Fira Sans SemiBold, and rsvg-convert for PNG exports.
The committed SVG and PNG files can be used without these tools.
"""

from os import environ
from pathlib import Path
from subprocess import check_output, run
from xml.sax.saxutils import escape

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT.parents[1] / "apps" / "studio" / "public"
font_override = environ.get("SEEVEE_BRAND_FONT")
if font_override:
    FONT = Path(font_override)
else:
    matched = check_output(["fc-match", "Fira Sans:style=SemiBold", "-f", "%{family}|%{file}"], text=True).strip()
    family, filename = matched.split("|", 1)
    if "Fira Sans" not in family:
        raise RuntimeError("Fira Sans SemiBold is required; set SEEVEE_BRAND_FONT to its .ttf file")
    FONT = Path(filename)
BLUE = "#5d8cff"
NAVY = "#182338"
INK = "#172133"
WHITE = "#f7f9fc"


def svg(width: int, height: int, body: str, title: str, desc: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">\n'
        f'  <title id="title">{escape(title)}</title>\n'
        f'  <desc id="desc">{escape(desc)}</desc>\n'
        f'{body}\n</svg>\n'
    )


# Two facing pages form a V at the spine. The leaves also read as a compact
# document mark at favicon size without relying on outlines or tiny details.
LEAVES = (
    '<path d="M27 29c14-2 27 1 37 9v61c-10-8-23-11-37-9V29Z" fill="{left}"/>'
    '<path d="M101 29c-14-2-27 1-37 9v61c10-8 23-11 37-9V29Z" fill="{right}"/>'
)


def mark(tile: bool = True, left: str = WHITE, right: str = BLUE) -> str:
    background = f'<rect width="128" height="128" rx="28" fill="{NAVY}"/>' if tile else ""
    return background + LEAVES.format(left=left, right=right)


font = TTFont(FONT)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
units = font["head"].unitsPerEm
advances = font["hmtx"].metrics


def outlined_text(value: str, x: float, baseline: float, size: float, color: str) -> tuple[str, float]:
    scale = size / units
    cursor = 0
    paths = []
    for char in value:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        d = pen.getCommands()
        if d:
            paths.append(f'<path d="{d}" transform="translate({cursor} 0)"/>')
        cursor += advances[name][0]
    content = "".join(paths)
    return (
        f'<g fill="{color}" transform="translate({x:g} {baseline:g}) scale({scale:g} {-scale:g})">{content}</g>',
        cursor * scale,
    )


def save(name: str, content: str) -> None:
    (ROOT / name).write_text(content)


save("mark.svg", svg(128, 128, mark(), "Seevee mark", "Two open pages meet in a V shape."))
save("mark-mono-dark.svg", svg(128, 128, mark(False, INK, INK), "Seevee mark, dark", "Single-color Seevee page mark for light surfaces."))
save("mark-mono-light.svg", svg(128, 128, mark(False, WHITE, WHITE), "Seevee mark, light", "Single-color Seevee page mark for dark surfaces."))
PUBLIC.joinpath("seevee-logo.svg").write_text((ROOT / "mark.svg").read_text())

for surface, word in (("dark", WHITE), ("light", INK)):
    title_path, _ = outlined_text("seevee", 166, 106, 98, word)
    body = f'<g transform="translate(16 16)">{mark()}</g>{title_path}'
    save(
        f"wordmark-{surface}.svg",
        svg(650, 160, body, "Seevee", "Seevee wordmark with a two-page V mark."),
    )
    mono_mark = f'<g transform="translate(16 16)">{mark(False, word, word)}</g>'
    save(
        f"wordmark-mono-{surface}.svg",
        svg(650, 160, mono_mark + title_path, "Seevee", "Single-color Seevee wordmark."),
    )

# Keep the historical root asset path valid for documentation and links.
legacy_title, _ = outlined_text("seevee", 166, 106, 98, WHITE)
(ROOT.parent / "seevee-logo.svg").write_text(
    svg(
        650,
        160,
        f'<rect width="650" height="160" rx="24" fill="#171d27"/><g transform="translate(16 16)">{mark()}</g>{legacy_title}',
        "Seevee",
        "Seevee wordmark on a dark background.",
    )
)


def document_art(dark: bool) -> str:
    paper = "#272f3b" if dark else "#ffffff"
    edge = "#3b4656" if dark else "#dce3ec"
    line = "#748195" if dark else "#a9b5c5"
    return f'''
  <g transform="translate(1115 32) rotate(9 170 246)" opacity=".55">
    <rect x="0" y="0" width="330" height="470" rx="20" fill="{paper}" stroke="{edge}" stroke-width="2"/>
  </g>
  <g transform="translate(1030 51) rotate(-7 170 246)">
    <rect x="0" y="0" width="330" height="470" rx="20" fill="{paper}" stroke="{edge}" stroke-width="2"/>
    <rect x="34" y="40" width="86" height="6" rx="3" fill="{BLUE}"/>
    <rect x="34" y="78" width="193" height="18" rx="7" fill="{WHITE if dark else INK}" opacity=".88"/>
    <rect x="34" y="116" width="262" height="4" rx="2" fill="{line}"/>
    <rect x="34" y="134" width="236" height="4" rx="2" fill="{line}"/>
    <rect x="34" y="173" width="90" height="5" rx="2.5" fill="{BLUE}"/>
    <rect x="34" y="200" width="262" height="4" rx="2" fill="{line}"/>
    <rect x="34" y="219" width="243" height="4" rx="2" fill="{line}"/>
    <rect x="34" y="238" width="255" height="4" rx="2" fill="{line}"/>
    <rect x="34" y="290" width="90" height="5" rx="2.5" fill="{BLUE}"/>
    <rect x="34" y="317" width="262" height="4" rx="2" fill="{line}"/>
    <rect x="34" y="336" width="237" height="4" rx="2" fill="{line}"/>
    <rect x="34" y="355" width="253" height="4" rx="2" fill="{line}"/>
  </g>'''


for surface in ("dark", "light"):
    dark = surface == "dark"
    bg = "#171d27" if dark else "#f2f5f9"
    headline = WHITE if dark else INK
    sub = "#aab6c6" if dark else "#536276"
    border = "#303b4a" if dark else "#e0e6ee"
    name_path, _ = outlined_text("seevee", 273, 184, 118, headline)
    body = f'''
  <rect width="1600" height="560" rx="24" fill="{bg}"/>
  <rect x="1" y="1" width="1598" height="558" rx="23" fill="none" stroke="{border}" stroke-width="2"/>
  <g transform="translate(91 72) scale(1.25)">{mark()}</g>
  {name_path}
  <rect x="93" y="265" width="66" height="5" rx="2.5" fill="{BLUE}"/>
  <text x="91" y="338" fill="{headline}" font-family="Fira Sans, Arial, sans-serif" font-size="44" font-weight="500">A focused workspace for your CV.</text>
  <text x="93" y="391" fill="{sub}" font-family="Fira Sans, Arial, sans-serif" font-size="25">Create, edit, and collaborate with your agent.</text>
  <text x="93" y="489" fill="{sub}" font-family="Fira Sans, Arial, sans-serif" font-size="18" font-weight="500" letter-spacing="3">LOCAL  ·  STRUCTURED  ·  YOURS</text>
  {document_art(dark)}'''
    save(
        f"banner-{surface}.svg",
        svg(1600, 560, body, "Seevee — a focused workspace for your CV", "Seevee logo and a pair of clean CV pages on a restrained background."),
    )
    card = f'''
  <rect width="1200" height="630" fill="{bg}"/>
  <g transform="translate(54 64) scale(.92)">{mark()}</g>
  {outlined_text("seevee", 198, 150, 100, headline)[0]}
  <rect x="57" y="242" width="55" height="5" rx="2.5" fill="{BLUE}"/>
  <text x="55" y="315" fill="{headline}" font-family="Fira Sans, Arial, sans-serif" font-size="42" font-weight="500">A focused workspace</text>
  <text x="55" y="366" fill="{headline}" font-family="Fira Sans, Arial, sans-serif" font-size="42" font-weight="500">for your CV.</text>
  <text x="57" y="432" fill="{sub}" font-family="Fira Sans, Arial, sans-serif" font-size="23">Create, edit, and collaborate with your agent.</text>
  <g transform="translate(-130 110) scale(.74)">{document_art(dark)}</g>'''
    save(
        f"social-{surface}.svg",
        svg(1200, 630, card, "Seevee social preview", "Seevee logo with a short description and clean CV pages."),
    )

for name, width in (
    ("mark", 512),
    ("banner-dark", 1600),
    ("banner-light", 1600),
    ("social-dark", 1200),
    ("social-light", 1200),
    ("wordmark-dark", 650),
    ("wordmark-light", 650),
):
    run(["rsvg-convert", "-w", str(width), "-o", str(ROOT / f"{name}.png"), str(ROOT / f"{name}.svg")], check=True)

run(["rsvg-convert", "-w", "180", "-o", str(PUBLIC / "apple-touch-icon.png"), str(ROOT / "mark.svg")], check=True)
run(["rsvg-convert", "-w", "32", "-o", str(PUBLIC / "favicon-32.png"), str(ROOT / "mark.svg")], check=True)
(PUBLIC / "seevee-social.png").write_bytes((ROOT / "social-dark.png").read_bytes())
