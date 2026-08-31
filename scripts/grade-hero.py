"""Regenerates public/images/run-hero-vivid.jpg from run-hero.jpg.

One-off asset tooling, not part of the build. Needs Pillow (`pip install
Pillow`); the app itself has no Python dependency.

The source is 2000x1334 of flat grey fog, which is why the landing read as
drab. Multiplying a vivid gradient over it lets the near-white fog take the
colour while the runner, already almost black, stays a real silhouette rather
than turning into a false-colour blob the way a gradient map would. The
background is then blurred along the runner's direction of travel and he is
composited back sharp, so the speed lives in the picture instead of in an
overlay.
"""

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

SRC = "public/images/run-hero.jpg"
DST = "public/images/run-hero-vivid.jpg"

# Deep indigo on the left, where the headline sits; hot orange on the right,
# behind the runner.
STOPS = [
    (0.00, "141C6B"),
    (0.30, "4B2C9E"),
    (0.58, "D93A2B"),
    (0.82, "FF7A1C"),
    (1.00, "FFA928"),
]
# The runner and his reflection, in source pixels.
RUNNER = (1400, 520, 1760, 1010)
BLUR_RADIUS = 40


def _rgb(value: str) -> tuple[int, int, int]:
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def horizontal_gradient(size, stops):
    width, height = size
    strip = Image.new("RGB", (width, 1))
    pixels = strip.load()
    for x in range(width):
        t = x / (width - 1)
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if p0 <= t <= p1:
                f = (t - p0) / (p1 - p0) if p1 > p0 else 0
                a, b = _rgb(c0), _rgb(c1)
                pixels[x, 0] = tuple(int(a[i] + (b[i] - a[i]) * f) for i in range(3))
                break
        else:
            pixels[x, 0] = _rgb(stops[-1][1])
    return strip.resize((width, height))


def motion_blur_x(image, radius, steps=21):
    """Directional blur: average copies shifted along x."""
    result = None
    for k in range(steps):
        offset = int(round((k / (steps - 1) - 0.5) * 2 * radius))
        shifted = image.transform(
            image.size, Image.AFFINE, (1, 0, offset, 0, 1, 0), resample=Image.BILINEAR
        )
        result = shifted if result is None else Image.blend(result, shifted, 1 / (k + 1))
    return result


def main() -> None:
    source = ImageEnhance.Contrast(Image.open(SRC).convert("RGB")).enhance(1.25)
    graded = ImageChops.multiply(source, horizontal_gradient(source.size, STOPS))
    graded = ImageEnhance.Color(graded).enhance(1.32)

    mask = Image.new("L", graded.size, 0)
    ImageDraw.Draw(mask).ellipse(RUNNER, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(46))
    composed = Image.composite(graded, motion_blur_x(graded, BLUR_RADIUS), mask)

    # Hold the left third down so white type never has to fight the gradient.
    scrim = horizontal_gradient(
        composed.size, [(0.0, "606060"), (0.34, "BEBEBE"), (0.55, "FFFFFF"), (1.0, "FFFFFF")]
    )
    out = ImageChops.multiply(composed, scrim)
    out.save(DST, "JPEG", quality=88, optimize=True, progressive=True)
    print(f"wrote {DST} {out.size[0]}x{out.size[1]}")


if __name__ == "__main__":
    main()
