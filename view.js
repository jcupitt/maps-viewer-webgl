/* View image on canvas.
 */

'use strict';

function initShaders() {
    if (shaderPrograms[0]) {
        return;
    }

    shaderPrograms[0] = getProgram("shader-fs-rti", "shader-vs-rti");

    shaderPrograms[0].tileSizeUniform = 
        gl.getUniformLocation(shaderPrograms[0], "uTileSize");
    shaderPrograms[0].tileTextureUniform = 
        gl.getUniformLocation(shaderPrograms[0], "uTileTexture");

}

var View = function(canvas, basename) {
    this.canvas = canvas;
    this.basename = basename;

    // the position of the top-left corner of the canvas within the larger image
    // we display
    this.viewport_left = 0;
    this.viewport_top = 0;
    this.viewport_width = canvas.width;
    this.viewport_height = canvas.height;

    // magnification layer .. 0 is zoomed out so the image fits in a tile,
    // then each +1 is a x2 layer larger
    this.layer = 0;

    // for each layer, the number of tiles in each direction ... we build this
    // when we've loaded the xml
    this.layer_properties = {}

    // index by layer, tile_y_number, tile_x_number
    this.cache = {};

    this.tile_size = 256;

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

    Mouse.attach(canvas);

    initGL(canvas);
    initShaders();
    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    // we draw tiles as single textured points at a certain x, y
    this.position = new Float32Array(2); 
    this.position_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.position_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.position, gl.DYNAMIC_DRAW);
    this.position_buffer.itemSize = 2;
    this.position_buffer.numItems = 1;

    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    mat4.ortho(0, gl.viewportWidth, 0, gl.viewportHeight, 0.1, 100, pMatrix);
    mat4.identity(mvMatrix);
    mat4.translate(mvMatrix, [0, 0, -1]);

    setShaderProgram(shaderPrograms[0]);
};

View.prototype.constructor = View;

View.prototype.loadProperties = function(filename) {
    if (this.request) {
        return;
    }

    this.properties = {};
    this.request = new XMLHttpRequest();
    this.request.view = this;
    this.request.onload = function() {
        if (this.status == 0 &&
            this.responseXML != null) {
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
            alert("unable to load image properties");
        }
    };
    this.request.open("GET", filename);
    this.request.send();
} 

View.prototype.setLayer = function(layer) {
    this.layer = layer;
};

View.prototype.setPosition = function(viewport_left, viewport_top) {
    this.viewport_left = viewport_left;
    this.viewport_top = viewport_top;
};

View.prototype.tileURL = function(z, x, y) {
    return this.basename + "/" + z + "/" + y + "/" + x + ".jpg";
};

View.prototype.drawTile = function(tile_size, tile) {
    var x = tile.tile_left * tile_size - this.viewport_left;
    var y = tile.tile_top * tile_size - this.viewport_top;

    setMatrixUniforms();

    this.position[0] = x + tile_size / 2;
    this.position[1] = this.viewport_height - (y + tile_size / 2);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.position_buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, this.position_buffer, this.position);
    gl.enableVertexAttribArray(currentProgram.vertexPositionAttribute);
    gl.vertexAttribPointer(currentProgram.vertexPositionAttribute, 
        this.position_buffer.itemSize, gl.FLOAT, false, 0, 0);

    gl.uniform1f(currentProgram.tileSizeUniform, this.tile_size);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tile);
    gl.uniform1i(currentProgram.tileTextureUniform, 0);

    gl.drawArrays(gl.POINTS, 0, this.position_buffer.numItems);
};

// get a tile from cache
View.prototype.getTile = function(z, x, y) {
    if (!this.cache[z]) {
        this.cache[z] = {};
    }
    var layer = this.cache[z];

    if (!layer[y]) {
        layer[y] = {};
    }
    var row = layer[y];

    return row[x];
}

// set a tile in cache
View.prototype.setTile = function(z, x, y, tile) {
    if (!this.cache[z]) {
        this.cache[z] = {};
    }
    var layer = this.cache[z];

    if (!layer[y]) {
        layer[y] = {};
    }
    var row = layer[y];

    row[x] = tile;
}

// draw a tile from cache
View.prototype.drawCachedTile = function(tile_size, z, x, y) {
    var tile_left = (x / tile_size) | 0;
    var tile_top = (y / tile_size) | 0;
    var tile = this.getTile(z, tile_left, tile_top);

    if (tile) {
        console.log("drawCachedTile: " + 
            z + ", " + tile_left + ", " + tile_top);
        this.drawTile(tile_size, tile);
    }
}

// scan the cache, drawing all visible tiles from layer 0 down to this layer
View.prototype.draw = function() {
    console.log("draw");

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
                this.drawCachedTile(tile_size, z, x, y); 
            }
        }
    }
};

// fetch a tile into cache
View.prototype.fetchTile = function(z, x, y) {
    var tile_left = (x / this.tile_size) | 0;
    var tile_top = (y / this.tile_size) | 0;
    var tile = this.getTile(z, tile_left, tile_top);

    if (!tile) { 
        if (tile_left >= 0 &&
            tile_top >= 0 &&
            tile_left < this.layer_properties[z].tiles_across &&
            tile_top < this.layer_properties[z].tiles_down) {
            tile = loadTexture(this.tileURL(z, tile_left, tile_top)); 
            tile.tile_left = tile_left;
            tile.tile_top = tile_top;
            tile.view = this;
            tile.onload = function() {
                tile.view.draw();
            };
            this.setTile(z, tile_left, tile_top, tile);
        }
    }
}

// fetch the tiles we need to display the current viewport
View.prototype.fetch = function() {
    // move left and up to tile boundary
    var start_left = 
        ((this.viewport_left / this.tile_size) | 0) * this.tile_size;
    var start_top = 
        ((this.viewport_top / this.tile_size) | 0) * this.tile_size;
    var right = this.viewport_left + this.viewport_width;
    var bottom = this.viewport_top + this.viewport_height;

    for (var y = start_top; y < bottom; y += this.tile_size) { 
        for (var x = start_left; x < right; x += this.tile_size) { 
            this.fetchTile(this.layer, x, y); 
        }
    }

    // we may have some already ... draw them
    this.draw();
};

