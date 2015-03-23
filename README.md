# maps-viewer-webgl

Experimental google maps image viewer using webgl for tile rendering.

# Make test image

Use google tiles: centre, always 256x256 ... otherwise we have to decompose
textures.

```bash
vips dzsave /data/john/pics/nina.jpg nina --layout google --properties
```

# TODO

* LRU for cache ejection, though always keep layer 0

* simple pan and zoom for testing
