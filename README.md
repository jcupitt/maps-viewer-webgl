# dzi-viewer-webgl

Experimental google maps viewer using webgl for tile rendering.

# Make test image

Use google tiles: centre, always 256x256 ... otherwise we have to decompose
textures.

```bash
vips dzsave /data/john/pics/nina.jpg nina --layout google --properties
```

# TODO

* draw all tiles intersecting the viewport from layer 0 painters-style

* scale tiles by layer

* LRU for cache ejection, though always keep layer 0

* get the xml meta from nina/nina/vips-properties.xml

* simple pan and zoom for testing
