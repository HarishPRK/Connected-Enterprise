# Branch atlas imagery

The globe uses Reto Stöckli’s July 2004 Blue Marble Next Generation composite for NASA Earth Observatory. The JPEG includes shaded land topography and ocean bathymetry. It is the same 5400 × 2700 source raster used in the reference globe. Its SHA-256 is `4f4240673a3a1b173d61b92ca4b07bac5fd17059ea5f725ba6da5a9c5386b7ba`. [NASA imagery collection](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/) · [NASA media guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/)

The camera’s regional views use separate images. All textures are equirectangular in WGS84 (EPSG:4326), with north at the top and east to the right. The bounds below are the outer edges of the raster.

| Asset | Source | West, south, east, north | Pixel size |
| --- | --- | --- | --- |
| `branch-earth.glb` | NASA Earth Observatory, Blue Marble Next Generation | −180, −90, 180, 90 | 5400 × 2700 |
| `texas-satellite.jpg` | NASA GIBS, Blue Marble Shaded Relief Bathymetry | −108, 23, −88, 40 | 2048 × 1740 |
| `dfw-satellite.jpg` | USGS Imagery Only, The National Map (USDA / USGS orthoimagery) | −97.5, 32.35, −96.1, 33.65 | 1792 × 1664 |

The DFW image is a full-extent export of the USGS Imagery Only basemap. Its response specifies the exact bounds above. This source provides consistent coverage over Lake Ray Hubbard and Lavon Lake. Both services are used during asset preparation, so opening the deployed atlas requires no imagery service credentials. [NASA GIBS API](https://nasa-gibs.github.io/gibs-api-docs/access-basics/) · [USGS Imagery Only service and source credits](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer)

Thin internal country and state lines use [world-atlas 2.0.2](https://github.com/topojson/world-atlas) and [us-atlas 3.0.1](https://github.com/topojson/us-atlas). Natural Earth and US Census geographic data are in the public domain. The accompanying license files cover the distributed topology.

## Regeneration

Save these four inputs using the linked names. The DFW export can change when USGS updates its mosaic.

- [blue-marble-july.jpg](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x5400x2700.jpg)
- [countries-110m.json](https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json)
- [texas-source.jpg](https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=BlueMarble_ShadedRelief_Bathymetry&STYLES=&SRS=EPSG:4326&BBOX=-108,23,-88,40&WIDTH=2048&HEIGHT=1740&FORMAT=image/jpeg)
- [dfw-satellite.jpg](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export?bbox=-97.5,32.35,-96.1,33.65&bboxSR=4326&imageSR=4326&size=1792,1664&format=jpg&f=image), saved directly in `src/assets/atlas`

From the repository root, run the following with Python, Pillow and Blender 4.5 LTS installed.

```sh
python tools/atlas/build_surface.py blue-marble-july.jpg countries-110m.json src/assets/atlas/us-states.json earth-surface.jpg --texas texas-source.jpg src/assets/atlas/texas-satellite.jpg
blender --background --factory-startup --python-exit-code 1 --python tools/atlas/build_globe.py -- earth-surface.jpg src/assets/atlas/branch-earth.glb
```

The Blender output is a unit sphere named `Earth` with a single embedded sRGB texture. The geographic UV seam lies on the antimeridian. The branch registry supplies operational markers independently of this reference imagery.
