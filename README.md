# maps-viewer-webgl

Experimental zooming image using webgl for tile rendering. The interface of
ArghView is supposed to drop easily into iipmooviewer.

# Make test image

A regular 2D colour image:

```bash
vips dzsave /data/john/pics/nina.jpg nina
```

A DeepZoom RTI image:


```
./make_RTI_dz.py /data/john/pics/ptm/Gertrud_cropped_1109.ptm x
```
