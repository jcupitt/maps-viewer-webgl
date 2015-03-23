# maps-viewer-webgl

Experimental google maps image viewer using webgl for tile rendering.

# Make test image

Use google tiles: centre, always 256x256 ... otherwise we have to decompose
textures.

```bash
vips dzsave /data/john/pics/nina.jpg nina --layout google --properties
```

# TODO

* we don't seem to paint upper bits of the pyramid in the right place, try
  disabling upper layers

* we seem to be chrome only for mouse actions

* LRU for cache ejection, though always keep layer 0
