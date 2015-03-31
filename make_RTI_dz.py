#!/usr/bin/python

import sys
import os
import glob
import logging
import shutil

#logging.basicConfig(level = logging.DEBUG)
from gi.repository import Vips

if len(sys.argv) != 3:
    print "usage: make_RTI_dz input.ptm outdir"
    sys.exit(1)

input_file = sys.argv[1]
output_dir = sys.argv[2]

print "Parsing header for ", input_file, "..."
with open(input_file) as f:
    line = f.readline().strip()
    if line != "PTM_1.2":
        print "Not a PTM 1.2 file"
        sys.exit(1)

    line = f.readline().strip()
    if line != "PTM_FORMAT_LRGB":
        print "Not an LRGB PTM"
        sys.exit(1)

    width = int(f.readline().strip())
    height = int(f.readline().strip())

    line = f.readline().strip()
    scales = [float(item) for item in line.split(" ")]
    line = f.readline().strip()
    offsets = [float(item) for item in line.split(" ")]

    if len(scales) != 6 or len(offsets) != 6:
        print "Not six scales and six offsets"
        sys.exit(1)

    coeff_offset = f.tell()
    rgb_offset = coeff_offset + width * height * 6;

print "Making output directory", output_dir
os.mkdir(output_dir)

print "Generating rgb pyramid ...";
image = Vips.Image.new_from_file_raw(sys.argv[1], width, height, 3, rgb_offset)
image.dzsave(os.path.join(output_dir, output_dir))

print "Generating H pyramid ...";
image = Vips.Image.new_from_file_raw(sys.argv[1], width, height, 6, coeff_offset)
image = image.extract_band(0, n = 3)
image.dzsave(os.path.join(output_dir, "H_pyramid"))

print "Generating L pyramid ...";
image = Vips.Image.new_from_file_raw(sys.argv[1], width, height, 6, coeff_offset)
image = image.extract_band(3, n = 3);
image.dzsave(os.path.join(output_dir, "L_pyramid"))

print "Combining pyramids ..."

for level_path in glob.glob(os.path.join(output_dir, "H_pyramid_files", "*")):
    level = os.path.split(level_path)[1]
    for tile_path in glob.glob(os.path.join(level_path, "*.jpeg")):
        tile = os.path.split(tile_path)[1]
        name, ext = os.path.splitext(tile)

        dest = os.path.join(output_dir, output_dir + "_files", level, name + "_1" + ext)
        os.rename(tile_path, dest)

for level_path in glob.glob(os.path.join(output_dir, "L_pyramid_files", "*")):
    level = os.path.split(level_path)[1]
    for tile_path in glob.glob(os.path.join(level_path, "*.jpeg")):
        tile = os.path.split(tile_path)[1]
        name, ext = os.path.splitext(tile)

        dest = os.path.join(output_dir, output_dir + "_files", level, name + "_2" + ext)
        os.rename(tile_path, dest)

shutil.rmtree(os.path.join(output_dir, "L_pyramid_files"))
shutil.rmtree(os.path.join(output_dir, "H_pyramid_files"))
os.remove(os.path.join(output_dir, "L_pyramid.dzi"))
os.remove(os.path.join(output_dir, "H_pyramid.dzi"))

print "Writing extra metadata ..."
with open(os.path.join(output_dir, "rti-data.txt"), "w") as f:
    for x in scales:
        f.write(str(x) + " ")
    f.write("\n")
    for x in offsets:
        f.write(str(x) + " ")
    f.write("\n")
