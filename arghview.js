/* ArghView ... tiny webgl tiled image viewer. This is supposed to be able to
 * fit inside iipmooviewer.
 *
 * TODO:
 *
 * - support rotate
 * - need methods to translate between clientX/Y coordinates and image cods
 * - could support morph animations?
 * - need to support richer fragment shaders, eg. RTI
 * - put the shader source in this file
 */

'use strict';

/* Make a new view oject.
 *
 * canvas: the thing we create the WebGL context on ... we fill this with pixels
 */
var ArghView = function (canvas) {
    this.canvas = canvas;
    canvas.arghView = this;

    // .set by setSource() below
    this.tileURL = null;
    this.maxSize = null;
    this.tileSize = null;
    this.numResolutions = null;

    // the current time, in ticks ... use for cache ejection
    this.time = 0;

    // the size of the canvas we render into
    this.viewportWidth = canvas.clientWidth;
    this.viewportHeight = canvas.clientHeight;

    this.log("ArghView: viewportWidth = " + this.viewportWidth + 
        ", viewportHeight = " + this.viewportHeight);

    // from the top-left-hand corner of the image, the distance to move to get
    // to the top-left-hand corner of the pixels we are displaying
    this.viewportLeft = 0;
    this.viewportTop = 0;

    window.addEventListener('resize', function () {
        this.viewportWidth = this.canvas.clientWidth;
        this.viewportHeight = this.canvas.clientHeight;
        this.log("ArghView: resize canvas to w = " + this.viewportWidth + 
            ", h = " + this.viewportHeight);

        // we may need to move the viewport, for example if we've sized the 
        // image larger than the viewport
        this.setPosition(this.viewportLeft, this.viewportTop);
    }.bind(this));

    // then each +1 is a x2 layer larger
    this.layer = 0;

    // this gets populated once we know the tile source, see below
    this.layerProperties = []

    // all our tiles in a flat array ... use this for things like cache 
    // ejection
    this.tiles = []

    // index by layer, tile y, tile x
    this.cache = [];

    // max number of tiles we cache, set once we have a tile source
    this.maxTiles = 0;

    this.initGL();
};

ArghView.prototype.constructor = ArghView;

ArghView.prototype.log = function (str) {
    //console.log(str);
}

ArghView.prototype.vertexShaderSource = 
"    attribute vec2 aVertexPosition; " +
"    attribute vec2 aTextureCoord; " +
" " +
"    uniform mat4 uMVMatrix; " +
"    uniform mat4 uPMatrix; " +
" " +
"    varying lowp vec2 vTextureCoord; " +
" " +
"    void main(void) { " +
"        gl_Position = " +
"            uPMatrix * uMVMatrix * vec4(aVertexPosition, 0.0, 1.0); " +
"	     vTextureCoord = aTextureCoord; " +
"   }";

ArghView.prototype.fragmentShaderSource = 
"    precision lowp float; " +
" " +
"    varying lowp vec2 vTextureCoord; " +
" " +
"    uniform sampler2D uTileTexture; " +
" " +
"    void main(void) { " +
"        gl_FragColor = texture2D(uTileTexture,  " +
"           vec2(vTextureCoord.s, vTextureCoord.t)); " +
"    } ";

/* points is a 2D array of like [[x1, y1], [x2, y2], ..], make a 
 * draw buffer.
 */
ArghView.prototype.bufferCreate = function (points) {
    var gl = this.gl;

    var vertex = [];
    for (var i = 0; i < points.length; i++) {
        vertex.push(points[i][0]);
        vertex.push(points[i][1]);
    }

    var vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertex), gl.STATIC_DRAW);
    vertexBuffer.itemSize = 2;
    vertexBuffer.numItems = points.length;

    return vertexBuffer;
}

ArghView.prototype.mvPushMatrix = function () {
    var copy = mat4.create();
    mat4.set(this.mvMatrix, copy);
    this.mvMatrixStack.push(copy);
}

ArghView.prototype.mvPopMatrix = function () {
    if (this.mvMatrixStack.length === 0) {
        throw "Invalid popMatrix!";
    }
    this.mvMatrix = this.mvMatrixStack.pop();
}

ArghView.prototype.setMatrixUniforms = function () {
    this.gl.uniformMatrix4fv(this.program.pMatrixUniform, false, 
        this.pMatrix);
    this.gl.uniformMatrix4fv(this.program.mvMatrixUniform, false, 
        this.mvMatrix);
}

ArghView.prototype.initGL = function () {
    var gl;

    gl = WebGLUtils.setupWebGL(this.canvas);
    if (!gl) {
        return; 
    }
    this.gl = gl;

    var vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, this.vertexShaderSource);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
        alert(gl.getShaderInfoLog(vertexShader));
        return;
    }

    var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, this.fragmentShaderSource);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
        alert(gl.getShaderInfoLog(fragmentShader));
        return;
    }

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
    this.vertexBuffer = this.bufferCreate([[1, 1], [1, 0], [0, 1], [0, 0]]);
    this.textureCoordsBuffer = this.vertexBuffer; 

    gl.clearColor(1.0, 1.0, 1.0, 1.0);
}

/* Public: set the source for image tiles ... parameters matched to 
 * iipmooview.
 *
 * tileURL: function (z, x, y){} ... makes a URL to fetch a tile from
 * maxSize: {w: .., h: ..} ... the dimensions of the largest layer, in pixels
 * tileSize: {w: .., h: ..} ... size of a tile, in pixels
 * numResolutions: int ... number of layers
 */
ArghView.prototype.setSource = function (tileURL, maxSize, 
        tileSize, numResolutions) {
    this.log("ArghView.setSource: ");

    this.tileURL = tileURL;
    this.maxSize = maxSize;
    this.tileSize = tileSize;
    this.numResolutions = numResolutions;

    // round n down to p boundary
    function roundDown(n, p) {
        return n - (n % p);
    }

    // round n up to p boundary
    function roundUp(n, p) {
        return roundDown(n + p - 1, p);
    }

    // need to calculate this from metadata ^^ above 
    this.layerProperties = []
    var width = maxSize.w;
    var height = maxSize.h;
    for (var i = numResolutions - 1; i >= 0; i--) {
        this.layerProperties[i] = {
            shrink: 1 << (numResolutions - i - 1),
            width: width,
            height: height,
            tilesAcross: (roundUp(width, tileSize.w) / tileSize.w) | 0,
            tilesDown: (roundUp(height, tileSize.h) / tileSize.h) | 0
        };
        width = (width / 2) | 0;
        height = (height / 2) | 0;
    }

    // max number of tiles we cache
    //
    // we want to keep gpu mem use down, so enough tiles that we can paint the
    // viewport three times over ... consider a 258x258 viewport with 256x256
    // tiles, we'd need up to 9 tiles to paint it once
    var tilesAcross = 1 + Math.ceil(this.viewportWidth / tileSize.w);
    var tilesDown = 1 + Math.ceil(this.viewportHeight / tileSize.h);
    this.maxTiles = 3 * tilesAcross * tilesDown; 

    // throw away any old state
    this.cache = [];
    this.tiles = [];
};

/* Public: set the layer being displayed.
 */
ArghView.prototype.setLayer = function (layer) {
    this.log("ArghView.setLayer: " + layer);

    this.time += 1;

    layer = Math.max(layer, 0);
    layer = Math.min(layer, this.numResolutions - 1);
    this.layer = layer;

    this.log("  (layer set to " + layer + ")");

    // we may need to move the image, for example to change the centreing 
    this.setPosition(this.viewportLeft, this.viewportTop);
};

ArghView.prototype.getLayer = function () {
    return this.layer;
};

/* Public: set the position of the viewport within the larger image.
 *
 * If we are zoomed out far enough that the image is smaller than the viewport,
 * centre the image.
 */
ArghView.prototype.setPosition = function (viewportLeft, viewportTop) {
    this.log("ArghView.setPosition: " + viewportLeft + ", " + viewportTop);

    this.time += 1;

    var layerWidth = this.layerProperties[this.layer].width;
    var layerHeight = this.layerProperties[this.layer].height;

    this.log("  (layer size is " + 
            layerWidth + ", " + layerHeight + ")");

    // constrain to viewport
    viewportLeft = Math.max(viewportLeft, 0);
    viewportLeft = Math.min(viewportLeft, layerWidth - this.viewportWidth); 
    viewportTop = Math.max(viewportTop, 0);
    viewportTop = Math.min(viewportTop, layerHeight - this.viewportHeight); 

    // if image < viewport, force centre
    if (layerWidth < this.viewportWidth) {
        viewportLeft = -(this.viewportWidth - layerWidth) / 2;
    }
    if (layerHeight < this.viewportHeight) {
        viewportTop = -(this.viewportHeight - layerHeight) / 2;
    }

    this.log("  (position set to " + 
            viewportLeft + ", " + viewportTop + ")");

    this.viewportLeft = viewportLeft;
    this.viewportTop = viewportTop;
};

/* Public: get the position of the viewport within the larger image.
 */
ArghView.prototype.getPosition = function () {
    return {x: this.viewportLeft, y: this.viewportTop};
};

// draw a tile at a certain tileSize ... tiles can be drawn very large if we are
// using a low-res tile as a placeholder while a high-res tile is being loaded
ArghView.prototype.tileDraw = function (tile, tileSize) {

    var gl = this.gl;
    var x = tile.tileLeft * tileSize.w - this.viewportLeft;
    var y = tile.tileTop * tileSize.h - this.viewportTop;

    this.log("ArghView.tileDraw: " + tile.tileLayer + ", " +
        tile.tileLeft + ", " + tile.tileTop + " at pixel " +
        "x = " + x + ", y = " + y + 
        ", w = " + tileSize.w + ", h = " + tileSize.h);

    this.mvPushMatrix();

    mat4.translate(this.mvMatrix, 
        [x, this.viewportHeight - y - tileSize.h, 0]); 
    mat4.scale(this.mvMatrix, [tileSize.w, tileSize.h, 1]);
    this.setMatrixUniforms();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tile);
    gl.uniform1i(this.program.tileTextureUniform, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.textureCoordsBuffer);
    gl.enableVertexAttribArray(this.program.textureCoordAttribute);
    gl.vertexAttribPointer(this.program.textureCoordAttribute, 
        this.textureCoordsBuffer.itemSize, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.enableVertexAttribArray(this.program.vertexPositionAttribute);
    gl.vertexAttribPointer(this.program.vertexPositionAttribute, 
        this.vertexBuffer.itemSize, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.vertexBuffer.numItems);

    this.mvPopMatrix();
};

// get a tile from cache
ArghView.prototype.tileGet = function (z, x, y) {
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
ArghView.prototype.tileAdd = function (tile) {
    if (!this.cache[tile.tileLayer]) {
        this.cache[tile.tileLayer] = [];
    }
    var layer = this.cache[tile.tileLayer];

    if (!layer[tile.tileTop]) {
        layer[tile.tileTop] = [];
    }
    var row = layer[tile.tileTop];

    if (row[tile.tileLeft]) {
        throw "tile overwritten!?!?!";
    }

    row[tile.tileLeft] = tile;
    tile.time = this.time;
    this.tiles.push(tile);
}

// delete the final tile in the tile list
ArghView.prototype.tilePop = function () {
    var tile = this.tiles.pop();
    this.log("ArghView.tilePop: " + tile.tileLayer + ", " + tile.tileLeft + 
            ", " + tile.tileTop);
    var layer = this.cache[tile.tileLayer];
    var row = layer[tile.tileTop];
    delete row[tile.tileLeft];
}

// if the cache has filled, trim it
//
// try to keep tiles in layer 0 and 1, and tiles in the current layer
ArghView.prototype.cacheTrim = function () {
    if (this.tiles.length > this.maxTiles) {
        var time = this.time;
        var layer = this.layer;

        var nTiles = this.tiles.length;
        for (var i = 0; i < nTiles; i++) {
            var tile = this.tiles[i];

            // calculate a "badness" score ... old tiles are bad, tiles 
            // outside the current layer are very bad, tiles in the top two 
            // layers are very good
            tile.badness = (time - tile.time) + 
                100 * Math.abs(layer - tile.tileLayer) -
                1000 * Math.max(0, 2 - tile.tileLayer);
        }

        // sort tiles most precious first
        this.tiles.sort(function (a, b) {
            return a.badness - b.badness;
        });

        /*
        this.log("ArghView.cacheTrim: after sort, tiles are:")
        this.log("  layer, left, top, age, badness")
        for (var i = 0; i < this.tiles.length; i++) {
            var tile = this.tiles[i];

            this.log("  " + tile.tileLayer + ", " + tile.tileLeft + ", " +
                tile.tileTop + ", " + (time - tile.time) + 
                ", " + tile.badness);
        }
         */

        while (this.tiles.length > 0.8 * this.maxTiles) {
            this.tilePop();
        }
    }
};

ArghView.prototype.loadTexture = function (url) { 
    var gl = this.gl;

    this.log("ArghView.loadTexture: " + url);

    var tex = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var img = new Image();
    img.src = url;
    img.onload = function () {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, 
                gl.UNSIGNED_BYTE, img);

        if (tex.onload) {
            tex.onload();
        }
    };

    return tex;
}

// fetch a tile into cache
ArghView.prototype.tileFetch = function (z, x, y) {
    var tileLeft = (x / this.tileSize.w) | 0;
    var tileTop = (y / this.tileSize.h) | 0;
    var tile = this.tileGet(z, tileLeft, tileTop);

    if (!tile) { 
        if (tileLeft >= 0 &&
            tileTop >= 0 &&
            tileLeft < this.layerProperties[z].tilesAcross &&
            tileTop < this.layerProperties[z].tilesDown) {
            var url = this.tileURL(z, tileLeft, tileTop); 
            var newTile = this.loadTexture(url); 
            newTile.view = this;
            newTile.tileLeft = tileLeft;
            newTile.tileTop = tileTop;
            newTile.tileLayer = z;
            this.tileAdd(newTile);

            newTile.onload = function () {
                this.log("ArghView.tileFetch: arrival of " + 
                        newTile.tileLayer + ", " + newTile.tileLeft + 
                        ", " + newTile.tileTop);
                newTile.view.draw();
            }.bind(this);
        }
    }
}

// draw a tile from cache
ArghView.prototype.cacheTileDraw = function (tileSize, z, x, y) {
    var tileLeft = (x / tileSize.w) | 0;
    var tileTop = (y / tileSize.h) | 0;
    var tile = this.tileGet(z, tileLeft, tileTop);

    if (tile) {
        this.tileDraw(tile, tileSize);
    }
}

// scan the cache, drawing all visible tiles from layer 0 down to this layer
ArghView.prototype.draw = function () {
    this.log("ArghView.draw");

    var gl = this.gl;

    this.time += 1;

    mat4.ortho(0, this.viewportWidth, 0, this.viewportHeight, 0.1, 100, 
        this.pMatrix);
    mat4.identity(this.mvMatrix);
    mat4.translate(this.mvMatrix, [0, 0, -1]);

    gl.viewport(0, 0, this.viewportWidth, this.viewportHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    for (var z = 0; z <= this.layer; z++) { 
        // we draw tiles at this layer at 1:1, tiles above this we double 
        // tileSize each time
        var tileSize = {
            w: this.tileSize.w << (this.layer - z),
            h: this.tileSize.h << (this.layer - z)
        };

        // move left and up to tile boundary
        var startLeft = ((this.viewportLeft / tileSize.w) | 0) * tileSize.w;
        var startTop = ((this.viewportTop / tileSize.h) | 0) * tileSize.h;
        var right = this.viewportLeft + this.viewportWidth;
        var bottom = this.viewportTop + this.viewportHeight;

        for (var y = startTop; y < bottom; y += tileSize.h) { 
            for (var x = startLeft; x < right; x += tileSize.w) { 
                this.cacheTileDraw(tileSize, z, x, y); 
            }
        }
    }
};

// fetch the tiles we need to display the current viewport, and draw it
ArghView.prototype.fetch = function () {
    this.log("ArghView.fetch");

    var gl = this.gl;

    this.time += 1;

    this.cacheTrim();

    // move left and up to tile boundary
    var startLeft = 
        ((this.viewportLeft / this.tileSize.w) | 0) * this.tileSize.w;
    var startTop = 
        ((this.viewportTop / this.tileSize.h) | 0) * this.tileSize.h;
    var right = this.viewportLeft + this.viewportWidth;
    var bottom = this.viewportTop + this.viewportHeight;

    for (var y = startTop; y < bottom; y += this.tileSize.h) { 
        for (var x = startLeft; x < right; x += this.tileSize.w) { 
            this.tileFetch(this.layer, x, y); 
        }
    }

    // we may have some already ... draw them
    this.draw();
};

