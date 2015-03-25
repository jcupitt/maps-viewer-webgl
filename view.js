/* View image on canvas.
 */

'use strict';

function initShaders() {
    if (shaderPrograms[0]) {
        return;
    }

    shaderPrograms[0] = getProgram("shader-fs-rti", "shader-vs-rti");

    shaderPrograms[0].textureCoordAttribute = 
        gl.getAttribLocation(shaderPrograms[0], "aTextureCoord");

    shaderPrograms[0].tileSizeUniform = 
        gl.getUniformLocation(shaderPrograms[0], "uTileSize");
    shaderPrograms[0].tileTextureUniform = 
        gl.getUniformLocation(shaderPrograms[0], "uTileTexture");

}

var View = function(canvas, basename) {
    this.canvas = canvas;
    this.basename = basename;
    canvas.view = this;

    // the current time, in ticks ... use for cache ejection
    this.time = 0;

    // the position of the top-left corner of the canvas within the larger image
    // we display
    this.viewport_left = 0;
    this.viewport_top = 0;
    this.viewport_width = canvas.width;
    this.viewport_height = canvas.height;

    // then each +1 is a x2 layer larger
    this.layer = 0;

    // for each layer, the number of tiles in each direction ... we build this
    // when we've loaded the xml
    this.layer_properties = {}

    // all our tiles in a flat array ... use this for things like cache 
    // ejection
    this.tiles = []

    // index by layer, tile_y_number, tile_x_number
    this.cache = [];

    this.tile_size = 256;

    // max number of tiles we cache
    //
    // we want to keep gpu mem use down, so enough tiles that we can paint the
    // viewport five times over
    this.max_tiles = (5 * (this.viewport_width * this.viewport_height) / 
        (this.tile_size * this.tile_size)) | 0;

    this.loadProperties(basename + "/" + basename + 
        "/vips-properties.xml");
    this.properties.onload = function() {
        // repeated round-down x2 shrink until we fit in a tile
        var width = this.properties.width;
        var height = this.properties.height;
        this.n_layers = 1;
        while (width > this.tile_size ||
            height > this.tile_size) {
            width = (width / 2) | 0;
            height = (height / 2) | 0;
            this.n_layers += 1;
        }

        var width = this.properties.width;
        var height = this.properties.height;
        for (var i = this.n_layers - 1; i >= 0; i--) {
            this.layer_properties[i] = {
                'shrink': 1 << (this.n_layers - i - 1),
                'width': width,
                'height': height,
                'tiles_across': (round_up(width, this.tile_size) / 
                        this.tile_size) | 0,
                'tiles_down': (round_up(height, this.tile_size) / 
                        this.tile_size) | 0
            };
            width = (width / 2) | 0;
            height = (height / 2) | 0;
        }

        // fetch tiles for this view
        this.fetch(); 
    };

    initGL(canvas);
    initShaders();
    gl.clearColor(1.0, 1.0, 1.0, 1.0);

    // we draw tiles as 1x1 squares, scaled, translated and textured
    var vertices = [[1, 1], [1, 0], [0, 1], [0, 0]]; 
    this.buffers = buffersCreate(vertices);
    this.texture_coords_buffer = this.buffers; 

    this.left_down = false;
    canvas.addEventListener('mousedown', function(event) {
        if (event.button == 0) {
            canvas.view.left_down = true;
            canvas.view.drag_start_left = event.clientX;
            canvas.view.drag_start_top = event.clientY;
            canvas.view.drag_start_viewport_left = canvas.view.viewport_left;
            canvas.view.drag_start_viewport_top = canvas.view.viewport_top;
        }
    });
    canvas.addEventListener('mouseup', function(event) {
        if (event.button == 0) {
            canvas.view.left_down = false;
        }
    });
    canvas.addEventListener('mouseleave', function(event) {
        canvas.view.left_down = false;
    });
    canvas.addEventListener('mousemove', function(event) {
        if (canvas.view.left_down) {
            var relative_x = event.clientX - canvas.view.drag_start_left;
            var relative_y = event.clientY - canvas.view.drag_start_top;
            var new_x = canvas.view.drag_start_viewport_left - relative_x;
            var new_y = canvas.view.drag_start_viewport_top - relative_y;

            canvas.view.setPosition(new_x, new_y);
            canvas.view.fetch();
            canvas.view.draw();
        }
    });
    canvas.addEventListener('mousewheel', function(event) {
        canvas.view.mousewheel.call(canvas.view, event);
    }, false);
    // different name in ff
    canvas.addEventListener('DOMMouseScroll', function(event) {
        canvas.view.mousewheel.call(canvas.view, event);
    }, false);
};

View.prototype.constructor = View;

View.prototype.mousewheel = function(event) {
    // cross-browser wheel delta
    var delta = Math.max(-1, Math.min(1, (event.wheelDelta || -event.detail)));

    var layer = this.layer;
    var x = (event.clientX + this.viewport_left) * 
        this.layer_properties[layer].shrink;
    var y = (event.clientY + this.viewport_top) *
        this.layer_properties[layer].shrink;

    layer += delta;
    this.setLayer(layer);
    layer = this.layer;

    var new_x = x / this.layer_properties[layer].shrink - event.clientX;
    var new_y = y / this.layer_properties[layer].shrink - event.clientY;
    this.setPosition(new_x, new_y); 

    this.fetch();
    this.draw();

    // prevent scroll handling
    return false;
};

View.prototype.loadProperties = function(filename) {
    if (this.request) {
        return;
    }

    this.properties = {};
    this.request = new XMLHttpRequest();
    this.request.view = this;
    this.request.onload = function() {
        if (this.responseXML != null) {
            var view = this.view;

            // document::image::properties::property
            var props = this.responseXML.documentElement.children[0].children;

            for (var i = 0; i < props.length; i++) {
                var prop = props[i];
                var name = prop.children[0].textContent;
                var value = prop.children[1];
                var type = value.attributes[0];

                var value_parsed;
                if (type.name == "type" &&
                    type.value == "gint") {
                    value_parsed = parseInt(value.textContent);
                }
                else {
                    value_parsed = value.textContent;
                }

                view.properties[name] = value_parsed;
            }

            if (view.properties.onload) {
                view.properties.onload.call(view);
            }
        }
        else {
            alert("unable to load properties from " + filename);
        }
    };
    this.request.open("GET", filename);
    this.request.send();
} 

View.prototype.setLayer = function(layer) {
    this.time += 1;

    console.log("setLayer: " + layer);
    if (this.n_layers) { 
        layer = Math.max(layer, 0);
        layer = Math.min(layer, this.n_layers - 1);
    }

    this.layer = layer;
};

View.prototype.setPosition = function(viewport_left, viewport_top) {
    this.time += 1;

    if (this.layer_properties &&
        this.layer_properties[this.layer]) { 
        var layer_width = this.layer_properties[this.layer].width;
        var layer_height = this.layer_properties[this.layer].height;

        viewport_left = Math.max(viewport_left, 0);
        viewport_left = Math.min(viewport_left, 
                layer_width - this.viewport_width); 
        viewport_top = Math.max(viewport_top, 0);
        viewport_top = Math.min(viewport_top, 
                layer_height - this.viewport_height); 
    }

    this.viewport_left = viewport_left;
    this.viewport_top = viewport_top;
};

View.prototype.tileURL = function(z, x, y) {
    return this.basename + "/" + z + "/" + y + "/" + x + ".jpg";
};

View.prototype.tileDraw = function(tile, tile_size) {
    var x = tile.tile_left * tile_size - this.viewport_left;
    var y = tile.tile_top * tile_size - this.viewport_top;

    mvPushMatrix();

    mat4.translate(mvMatrix, [x, this.viewport_height - y - tile_size, 0]); 
    mat4.scale(mvMatrix, [tile_size, tile_size, 1]);
    setMatrixUniforms();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tile);
    gl.uniform1i(currentProgram.tileTextureUniform, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texture_coords_buffer);
    gl.enableVertexAttribArray(currentProgram.textureCoordAttribute);
    gl.vertexAttribPointer(currentProgram.textureCoordAttribute, 
        this.texture_coords_buffer.itemSize, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers);
    gl.enableVertexAttribArray(currentProgram.vertexPositionAttribute);
    gl.vertexAttribPointer(currentProgram.vertexPositionAttribute, 
        this.buffers.itemSize, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.buffers.numItems);

    mvPopMatrix();
};

// get a tile from cache
View.prototype.tileGet = function(z, x, y) {
    if (!this.cache[z]) {
        this.cache[z] = [];
    }
    var layer = this.cache[z];

    if (!layer[y]) {
        layer[y] = [];
    }
    var row = layer[y];

    var tile = row[x];

    if (tile) {
        tile.time = this.time;
    }

    return tile;
}

// add a tile to the cache
View.prototype.tileAdd = function(tile) {
    if (!this.cache[tile.tile_layer]) {
        this.cache[tile.tile_layer] = [];
    }
    var layer = this.cache[tile.tile_layer];

    if (!layer[tile.tile_top]) {
        layer[tile.tile_top] = [];
    }
    var row = layer[tile.tile_top];

    if (row[tile.tile_left]) {
        console.log("tile overwritten!?!?!");
    }

    row[tile.tile_left] = tile;
    tile.time = this.time;
    this.tiles.push(tile);
}

// delete the final tile in the tile list
View.prototype.tilePop = function() {
    var tile = this.tiles.pop();
    console.log("tilePop: " + tile.tile_layer + ", " + tile.tile_left + 
            ", " + tile.tile_top);
    var layer = this.cache[tile.tile_layer];
    var row = layer[tile.tile_top];
    delete row[tile.tile_left];
}

// if the cache has filled, trim it
//
// try to keep tiles in layer 0 and 1, and tiles in the current layer
View.prototype.cacheTrim = function() {
    if (this.tiles.length > this.max_tiles) {
        var time = this.time;
        var layer = this.layer;

        var n_tiles = this.tiles.length;
        for (var i = 0; i < n_tiles; i++) {
            var tile = this.tiles[i];

            // calculate a "badness" score ... old tiles are bad, tiles 
            // outside the current layer are very bad, tiles in the top two 
            // layers are very good
            tile.badness = (time - tile.time) + 
                100 * Math.abs(layer - tile.tile_layer) -
                1000 * Math.max(0, 2 - tile.tile_layer);
        }

        // sort tiles as most precious first
        this.tiles.sort(function(a, b) {
            return a.badness - b.badness;
        });

        /*
        console.log("cacheTrim: after sort, tiles are:")
        console.log("  layer, left, top, age, badness")
        for (var i = 0; i < this.tiles.length; i++) {
            var tile = this.tiles[i];

            console.log("  " + tile.tile_layer + ", " + tile.tile_left + ", " +
                    tile.tile_top + ", " + (time - tile.time) + 
                    ", " + tile.badness);
        }
         */

        while (this.tiles.length > 0.8 * this.max_tiles) {
            this.tilePop();
        }
    }
};

// fetch a tile into cache
View.prototype.tileFetch = function(z, x, y) {
    var tile_left = (x / this.tile_size) | 0;
    var tile_top = (y / this.tile_size) | 0;
    var tile = this.tileGet(z, tile_left, tile_top);

    if (!tile) { 
        if (tile_left >= 0 &&
            tile_top >= 0 &&
            tile_left < this.layer_properties[z].tiles_across &&
            tile_top < this.layer_properties[z].tiles_down) {
            var new_tile = loadTexture(this.tileURL(z, tile_left, tile_top)); 

            new_tile.view = this;
            new_tile.tile_left = tile_left;
            new_tile.tile_top = tile_top;
            new_tile.tile_layer = z;
            this.tileAdd(new_tile);

            new_tile.onload = function() {
                new_tile.view.draw();
            };
        }
    }
}

// draw a tile from cache
View.prototype.cacheTileDraw = function(tile_size, z, x, y) {
    var tile_left = (x / tile_size) | 0;
    var tile_top = (y / tile_size) | 0;
    var tile = this.tileGet(z, tile_left, tile_top);

    if (tile) {
        //console.log("cacheTileDraw: " + z + ", " + tile_left + ", " + tile_top);
        this.tileDraw(tile, tile_size);
    }
}

// scan the cache, drawing all visible tiles from layer 0 down to this layer
View.prototype.draw = function() {
    this.time += 1;

    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    setShaderProgram(shaderPrograms[0]);

    mat4.ortho(0, gl.viewportWidth, 0, gl.viewportHeight, 0.1, 100, pMatrix);
    mat4.identity(mvMatrix);
    mat4.translate(mvMatrix, [0, 0, -1]);

    for (var z = 0; z <= this.layer; z++) { 
        // we draw tiles at this layer at 1:1, tiles above this we double 
        // tile_size each time
        var tile_size = this.tile_size << (this.layer - z);

        // move left and up to tile boundary
        var start_left = 
            ((this.viewport_left / tile_size) | 0) * tile_size;
        var start_top = 
            ((this.viewport_top / tile_size) | 0) * tile_size;
        var right = this.viewport_left + this.viewport_width;
        var bottom = this.viewport_top + this.viewport_height;

        for (var y = start_top; y < bottom; y += tile_size) { 
            for (var x = start_left; x < right; x += tile_size) { 
                this.cacheTileDraw(tile_size, z, x, y); 
            }
        }
    }
};

// fetch the tiles we need to display the current viewport
View.prototype.fetch = function() {
    this.cacheTrim();

    this.time += 1;

    // move left and up to tile boundary
    var start_left = 
        ((this.viewport_left / this.tile_size) | 0) * this.tile_size;
    var start_top = 
        ((this.viewport_top / this.tile_size) | 0) * this.tile_size;
    var right = this.viewport_left + this.viewport_width;
    var bottom = this.viewport_top + this.viewport_height;

    for (var y = start_top; y < bottom; y += this.tile_size) { 
        for (var x = start_left; x < right; x += this.tile_size) { 
            this.tileFetch(this.layer, x, y); 
        }
    }

    // we may have some already ... draw them
    this.draw();
};

