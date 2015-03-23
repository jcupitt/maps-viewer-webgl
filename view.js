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

    // magnification layer .. 0 is zoomed out, then x2 for each layer higher
    this.layer = 0;

    // index by layer, tile_y_number, tile_x_number
    this.cache = {};

    this.tile_size = 256;

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

View.prototype.setLayer = function(layer) {
    this.layer = layer;
};

View.prototype.setPosition = function(viewport_left, viewport_top) {
    this.viewport_left = viewport_left;
    this.viewport_top = viewport_top;
};

View.prototype.tileURL = function(x, y) {
    return this.basename + "/" + this.layer + "/" + y + "/" + x + ".jpg";
};

View.prototype.drawTile = function(tile) {
    var tile_size = this.tile_size;
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
View.prototype.fetchAndDrawTile = function(x, y) {
    var tile_left = (x / this.tile_size) | 0;
    var tile_top = (y / this.tile_size) | 0;

    if (!this.cache[this.layer]) {
        this.cache[this.layer] = {};
    }
    var layer = this.cache[this.layer];

    if (!layer[tile_top]) {
        layer[tile_top] = {};
    }
    var row = layer[tile_top];

    if (!row[tile_left]) {
        var tile = loadTexture(this.tileURL(tile_left, tile_top)); 

        tile.tile_left = tile_left;
        tile.tile_top = tile_top;
        tile.view = this;
        tile.onload = function() {
            tile.view.draw();
        };

        row[tile_left] = tile;
    }
    else {
        this.drawTile(row[tile_left]);
    }
}

// draw all tiles in cache
View.prototype.draw = function() {
    console.log("draw");

    // move left and up to tile boundary
    var start_left = 
        ((this.viewport_left / this.tile_size) | 0) * this.tile_size;
    var start_top = 
        ((this.viewport_top / this.tile_size) | 0) * this.tile_size;
    var right = this.viewport_left + this.viewport_width;
    var bottom = this.viewport_top + this.viewport_height;

    for (var y = start_top; y < bottom; y += this.tile_size) { 
        for (var x = start_left; x < right; x += this.tile_size) { 
            this.fetchAndDrawTile(x, y); 
        }
    }
};
