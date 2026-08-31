"""Regenerates public/images/run-hero.jpg from run-hero-source.jpg.

One-off asset tooling, not part of the build. Needs Pillow (`pip install
Pillow`); the app itself has no Python dependency.

The source is a free-licence Unsplash photograph by Miguel A Amutio
(@amutiomi) — a tight crop of marathon runners' legs, which is the thing this
app actually measures. It already carries the colour the page wants, in the
shoes: neon yellow, orange, electric blue. So this script amplifies what is
there rather than repainting it. An earlier version of this file gradient-
mapped a grey photo instead and the result looked like thermal imaging; false
colour on skin is the tell, so nothing here shifts hue.

What it does: lifts saturation and contrast so the shoes separate from the
asphalt, then multiplies a deep indigo down the left edge — a bed for the
white headline that leaves the right side untouched — and blurs that same
edge along the runners' direction of travel so the quiet side reads as speed
rather than as an empty box.
"""

from PIL import Image, ImageChops, ImageEnhance

SRC = "public/images/run-hero-source.jpg"
DST = "public/images/run-hero.jpg"

SATURATION = 1.38
CONTRAST = 1.12
BLUR_RADIUS = 46

# Multiplied over the photo: deep indigo at the left edge, white (no change)
# from the middle out, so the shoes keep their own colour.
SCRIM = [(0.00, "141B57"), (0.26, "3D4278"), (0.62, "BFC1D8"), (0.84, "FFFFFF"), (1.00, "FFFFFF")]
# How much motion blur each column gets: full at the left edge, none by 55%.
BLUR_RAMP = [(0.00, "FFFFFF"), (0.30, "9A9A9A"), (0.55, "000000"), (1.00, "000000")]


def _rgb(value: str) -> tuple[int, int, int]:
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def horizontal_gradient(size, stops, mode="RGB"):
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
    out = strip.resize((width, height))
    return out.convert("L") if mode == "L" else out


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
    image = Image.open(SRC).convert("RGB")
    image = ImageEnhance.Color(image).enhance(SATURATION)
    image = ImageEnhance.Contrast(image).enhance(CONTRAST)

    streaked = motion_blur_x(image, BLUR_RADIUS)
    image = Image.composite(streaked, image, horizontal_gradient(image.size, BLUR_RAMP, "L"))
    image = ImageChops.multiply(image, horizontal_gradient(image.size, SCRIM))

    image.save(DST, "JPEG", quality=86, optimize=True, progressive=True)
    print(f"wrote {DST} {image.size[0]}x{image.size[1]}")


if __name__ == "__main__":
    main()
