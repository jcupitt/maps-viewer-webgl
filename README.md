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

There's a C version of `make_RTI_dz` as well, this can be useful for
platforms where Python is hard to get working. Cross-compile from Linux to
Windows with:

```bash
export VIPSDIR=/home/john/GIT/maps-viewer-webgl/cross/vips-dev-8.0.2
i686-w64-mingw32-gcc \
	-mms-bitfields -march=i686 \
	-I$VIPSDIR/include \
	-I$VIPSDIR/include/glib-2.0 \
	-I$VIPSDIR/lib/glib-2.0/include \
	make_RTI_dz.c \
	-L$VIPSDIR/lib \
	-lvips -lz -ljpeg -lstdc++ -lxml2 -lfftw3 -lm \
	-lMagickWand-6.Q16 \
	-llcms2 -lopenslide -lpangoft2-1.0 -ltiff -lpng14 -lexif \
	-lMagickCore-6.Q16 -lpango-1.0 -lfreetype -lfontconfig -lgobject-2.0 \
	-lgmodule-2.0 -lgthread-2.0 -lglib-2.0 -lintl \
	-o make_RTI_dz.exe
```

