/* ArghView ... tiny webgl tiled image viewer. This is supposed to be able to
 * fit inside iipmooviewer.
 *
 * TODO:
 *
 * - support rotate
 * - add a .reload() method to throw away and reload everything after swapping
 *   the image
 * - need to center the image within the canvas if it's smaller
 * - need methods to translate between clientX/Y coordinates and image cods
 * - could support morph animations?
 * - need to support richer fragment shaders, eg. RTI
 *
 */

'use strict';

/* Parameters are matched tto iipmooviewer:
 * canvas: the thing we create the WebGL context on ... we fill this with pixels
 * tileURL: function(z, x, y){} ... makes a URL to fetch a tile from
 * max_size: {w: .., h: ..} ... the dimensions of the largest layer, in pixels
 * tileSize: {w: .., h: ..} ... size of a tile, in pixels
 * num_resolutions: int ... number of layers
 */
var ArghView = function(canvas, tileURL, max_size, tileSize, num_resolutions) {
    this.canvas = canvas;
    this.tileURL = tileURL;
    this.max_size = max_size;
    this.tileSize = tileSize;
    this.num_resolutions = num_resolutions;
    canvas.arghView = this;

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

    // round n down to p boundary
    function round_down(n, p) {
        return n - (n % p);
    }

    // round n up to p boundary
    function round_up(n, p) {
        return round_down(n + p - 1, p);
    }

    // need to calculate this from metadata ^^ above 
    this.layer_properties = []
    var width = max_size.w;
    var height = max_size.h;
    for (var i = num_resolutions - 1; i >= 0; i--) {
        this.layer_properties[i] = {
            shrink: 1 << (num_resolutions - i - 1),
            width: width,
            height: height,
            tiles_across: (round_up(width, tileSize.w) / tileSize.w) | 0,
            tiles_down: (round_up(height, tileSize.h) / tileSize.h) | 0
        };
        width = (width / 2) | 0;
        height = (height / 2) | 0;
    }

    // all our tiles in a flat array ... use this for things like cache 
    // ejection
    this.tiles = []

    // index by layer, tile_y_number, tile_x_number
    this.cache = [];

    // max number of tiles we cache
    //
    // we want to keep gpu mem use down, so enough tiles that we can paint the
    // viewport three times over ... consider a 258x258 viewport with 256x256
    // tiles, we'd need up to 9 tiles to paint it once
    var tiles_across = 1 + Math.ceil(this.viewport_width / tileSize.w);
    var tiles_down = 1 + Math.ceil(this.viewport_height / tileSize.h);
    this.max_tiles = 3 * tiles_across * tiles_down; 

    this.initGL();

};

ArghView.prototype.constructor = ArghView;

ArghView.prototype.getShader = function(id) {
    var gl = this.gl;

    var shaderScript = document.getElementById(id);
    if (!shaderScript) {
        return null;
    }

    var str = "";
    var k = shaderScript.firstChild;
    while (k) {
        if (k.nodeType == 3) {
            str += k.textContent;
        }
        k = k.nextSibling;
    }

    var shader;
    if (shaderScript.type == "x-shader/x-fragment") {
        shader = gl.createShader(gl.FRAGMENT_SHADER);
    } 
    else if (shaderScript.type == "x-shader/x-vertex") {
        shader = gl.createShader(gl.VERTEX_SHADER);
    } 
    else {
        return null;
    }

    gl.shaderSource(shader, str);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert(gl.getShaderInfoLog(shader));
        return null;
    }

    return shader;
}

/* points is a 2D array of like [[x1, y1], [x2, y2], ..], make a 
 * draw buffer.
 */
ArghView.prototype.bufferCreate = function(points) {
    var gl = this.gl;

    var vertex = [];
    for (var i = 0; i < points.length; i++) {
        vertex.push(points[i][0]);
        vertex.push(points[i][1]);
    }

    var vertex_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertex), gl.STATIC_DRAW);
    vertex_buffer.itemSize = 2;
    vertex_buffer.numItems = points.length;

    return vertex_buffer;
}

ArghView.prototype.mvPushMatrix = function() {
    var copy = mat4.create();
    mat4.set(this.mvMatrix, copy);
    this.mvMatrixStack.push(copy);
}

ArghView.prototype.mvPopMatrix = function() {
    if (this.mvMatrixStack.length == 0) {
        throw "Invalid popMatrix!";
    }
    this.mvMatrix = this.mvMatrixStack.pop();
}

ArghView.prototype.setMatrixUniforms = function() {
    this.gl.uniformMatrix4fv(this.program.pMatrixUniform, false, 
        this.pMatrix);
    this.gl.uniformMatrix4fv(this.program.mvMatrixUniform, false, 
        this.mvMatrix);
}

ArghView.prototype.initGL = function() {
    var gl;

    gl = WebGLUtils.setupWebGL(this.canvas);
    this.gl = gl;

    gl.viewportWidth = this.canvas.width;
    gl.viewportHeight = this.canvas.height;

    var fragmentShader = this.getShader("shader-fs-argh");
    var vertexShader = this.getShader("shader-vs-argh");

    var program = gl.createProgram();
    this.program = program;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        alert("Could not initialise shaders");
    }

    program.vertexPositionAttribute = 
        gl.getAttribLocation(program, "aVertexPosition");
    program.textureCoordAttribute = 
        gl.getAttribLocation(program, "aTextureCoord");

    program.pMatrixUniform = gl.getUniformLocation(program, "uPMatrix");
    program.mvMatrixUniform = gl.getUniformLocation(program, "uMVMatrix");
    program.tileSizeUniform = gl.getUniformLocation(program, "uTileSize");
    program.tileTextureUniform = gl.getUniformLocation(program, "uTileTexture");

    gl.useProgram(program);

    this.pMatrix = mat4.create();
    this.mvMatrix = mat4.create();
    this.mvMatrixStack = [];

    // we draw tiles as 1x1 squares, scaled, translated and textured
    this.vertex_buffer = this.bufferCreate([[1, 1], [1, 0], [0, 1], [0, 0]]);
    this.texture_coords_buffer = this.vertex_buffer; 

    gl.clearColor(1.0, 1.0, 1.0, 1.0);
}

/* Public: set the layer being displayed.
 */
ArghView.prototype.setLayer = function(layer) {
    this.time += 1;

    console.log("setLayer: " + layer);
    if (this.num_resolutions) { 
        layer = Math.max(layer, 0);
        layer = Math.min(layer, this.num_resolutions - 1);
    }

    this.layer = layer;
};

ArghView.prototype.getLayer = function() {
    return this.layer;
};

/* Public: set the position of the viewport within the larger image.
 */
ArghView.prototype.setPosition = function(viewport_left, viewport_top) {
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

/* Public: get the position of the viewport within the larger image.
 */
ArghView.prototype.getPosition = function() {
    return {x: this.viewport_left, y: this.viewport_top};
};

// draw a tile at a certain tileSize ... tiles can be drawn very large if we are
// using a low-res tile as a placeholder while a high-res tile is being loaded
ArghView.prototype.tileDraw = function(tile, tileSize) {
    var gl = this.gl;
    var x = tile.tile_left * tileSize.w - this.viewport_left;
    var y = tile.tile_top * tileSize.h - this.viewport_top;

    this.mvPushMatrix();

    mat4.translate(this.mvMatrix, 
        [x, this.viewport_height - y - tileSize.h, 0]); 
    mat4.scale(this.mvMatrix, [tileSize.w, tileSize.h, 1]);
    this.setMatrixUniforms();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tile);
    gl.uniform1i(this.program.tileTextureUniform, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texture_coords_buffer);
    gl.enableVertexAttribArray(this.program.textureCoordAttribute);
    gl.vertexAttribPointer(this.program.textureCoordAttribute, 
        this.texture_coords_buffer.itemSize, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
    gl.enableVertexAttribArray(this.program.vertexPositionAttribute);
    gl.vertexAttribPointer(this.program.vertexPositionAttribute, 
        this.vertex_buffer.itemSize, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.vertex_buffer.numItems);

    this.mvPopMatrix();
};

// get a tile from cache
ArghView.prototype.tileGet = function(z, x, y) {
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
ArghView.prototype.tileAdd = function(tile) {
    if (!this.cache[tile.tile_layer]) {
        this.cache[tile.tile_layer] = [];
    }
    var layer = this.cache[tile.tile_layer];

    if (!layer[tile.tile_top]) {
        layer[tile.tile_top] = [];
    }
    var row = layer[tile.tile_top];

    if (row[tile.tile_left]) {
        throw "tile overwritten!?!?!";
    }

    row[tile.tile_left] = tile;
    tile.time = this.time;
    this.tiles.push(tile);
}

// delete the final tile in the tile list
ArghView.prototype.tilePop = function() {
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
ArghView.prototype.cacheTrim = function() {
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

        // sort tiles most precious first
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

ArghView.prototype.loadTexture = function(url) { 
    var gl = this.gl;

    console.log("loadTexture: " + url);

    var tex = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var img = new Image();
    img.src = url;
    img.onload = function() {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 
        0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

        if (tex.onload) {
            tex.onload();
        }
    };

    return tex;
}

// fetch a tile into cache
ArghView.prototype.tileFetch = function(z, x, y) {
    var tile_left = (x / this.tileSize.w) | 0;
    var tile_top = (y / this.tileSize.h) | 0;
    var tile = this.tileGet(z, tile_left, tile_top);

    if (!tile) { 
        if (tile_left >= 0 &&
            tile_top >= 0 &&
            tile_left < this.layer_properties[z].tiles_across &&
            tile_top < this.layer_properties[z].tiles_down) {
            var url = this.tileURL(z, tile_left, tile_top); 
            var new_tile = this.loadTexture(url); 
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
ArghView.prototype.cacheTileDraw = function(tileSize, z, x, y) {
    var tile_left = (x / tileSize.w) | 0;
    var tile_top = (y / tileSize.h) | 0;
    var tile = this.tileGet(z, tile_left, tile_top);

    if (tile) {
        //console.log("cacheTileDraw: " + z + ", " + tile_left + ", " + tile_top);
        this.tileDraw(tile, tileSize);
    }
}

// scan the cache, drawing all visible tiles from layer 0 down to this layer
ArghView.prototype.draw = function() {
    var gl = this.gl;

    this.time += 1;

    mat4.ortho(0, gl.viewportWidth, 0, gl.viewportHeight, 0.1, 100, 
        this.pMatrix);
    mat4.identity(this.mvMatrix);
    mat4.translate(this.mvMatrix, [0, 0, -1]);

    for (var z = 0; z <= this.layer; z++) { 
        // we draw tiles at this layer at 1:1, tiles above this we double 
        // tileSize each time
        var tileSize = {
            w: this.tileSize.w << (this.layer - z),
            h: this.tileSize.h << (this.layer - z)
        };

        // move left and up to tile boundary
        var start_left = ((this.viewport_left / tileSize.w) | 0) * tileSize.w;
        var start_top = ((this.viewport_top / tileSize.h) | 0) * tileSize.h;
        var right = this.viewport_left + this.viewport_width;
        var bottom = this.viewport_top + this.viewport_height;

        for (var y = start_top; y < bottom; y += tileSize.h) { 
            for (var x = start_left; x < right; x += tileSize.w) { 
                this.cacheTileDraw(tileSize, z, x, y); 
            }
        }
    }
};

// fetch the tiles we need to display the current viewport, and draw it
ArghView.prototype.fetch = function() {
    var gl = this.gl;

    this.time += 1;

    /* Clear before fetch, not before draw. Each fetch can result in many draw
     * passes as tiles arrive, we don't want to wipe each time.
     */
    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.cacheTrim();

    // move left and up to tile boundary
    var start_left = 
        ((this.viewport_left / this.tileSize.w) | 0) * this.tileSize.w;
    var start_top = 
        ((this.viewport_top / this.tileSize.h) | 0) * this.tileSize.h;
    var right = this.viewport_left + this.viewport_width;
    var bottom = this.viewport_top + this.viewport_height;

    for (var y = start_top; y < bottom; y += this.tileSize.h) { 
        for (var x = start_left; x < right; x += this.tileSize.w) { 
            this.tileFetch(this.layer, x, y); 
        }
    }

    // we may have some already ... draw them
    this.draw();
};

