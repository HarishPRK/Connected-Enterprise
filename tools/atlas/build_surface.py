"""Bake internal borders into NASA's equirectangular July Blue Marble and Texas inset.

Usage: python tools/atlas/build_surface.py blue-marble-july.jpg countries-110m.json \
    src/assets/atlas/us-states.json world.jpg [--texas tx-source.jpg tx-output.jpg]
"""
import argparse
import json
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw


def shared_boundaries(path, layer):
    """Only draw arcs shared by two regions; coastlines come from the imagery."""
    topology = json.loads(path.read_text(encoding="utf-8"))
    references = Counter()
    for feature in topology["objects"][layer]["geometries"]:
        polygons = feature["arcs"] if feature["type"] == "MultiPolygon" else [feature["arcs"]]
        references.update({index if index >= 0 else ~index for polygon in polygons for ring in polygon for index in ring})
    (sx, sy), (tx, ty) = topology["transform"]["scale"], topology["transform"]["translate"]
    for index, owners in references.items():
        if owners < 2:
            continue
        lon = lat = 0
        path = []
        for dx, dy in topology["arcs"][index]:
            lon += dx
            lat += dy
            point = (lon * sx + tx, lat * sy + ty)
            if path and abs(path[-1][0] - point[0]) > 180:
                if len(path) > 1:
                    yield path
                path = []
            path.append(point)
        if len(path) > 1:
            yield path


def bake(source, destination, extent, countries, states):
    with Image.open(source) as image:
        raster = image.convert("RGB")
    west, south, east, north = extent
    sx, sy = raster.width / (east - west), raster.height / (north - south)
    ink = ImageDraw.Draw(raster, "RGBA")
    for paths, tone in ((countries, (232, 233, 210, 125)), (states, (238, 242, 223, 106))):
        for points in paths:
            pixel = [((lon - west) * sx, (north - lat) * sy) for lon, lat in points]
            ink.line(pixel, fill=(18, 31, 35, 96), width=2)
            ink.line(pixel, fill=tone, width=1)
    raster.save(destination, quality=88, optimize=True, subsampling=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raster", type=Path)
    parser.add_argument("countries", type=Path)
    parser.add_argument("states", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--texas", type=Path, nargs=2, metavar=("INPUT", "OUTPUT"))
    args = parser.parse_args()
    borders = list(shared_boundaries(args.countries, "countries"))
    state_lines = list(shared_boundaries(args.states, "states"))
    bake(args.raster, args.output, (-180, -90, 180, 90), borders, state_lines)
    if args.texas:
        bake(*args.texas, (-108, 23, -88, 40), borders, state_lines)
