/* Misc utility functions. 
 */

'use strict';

function randint(min, max) {
    min |= 0;
    max |= 0;

    return ((Math.random() * (1 + max - min)) | 0) + min;
}

function rad(angle) {
    return angle * Math.PI / 180.0;
}

var gl;

function initGL(canvas) {
    gl = WebGLUtils.setupWebGL(canvas);
    gl.viewportWidth = canvas.width;
    gl.viewportHeight = canvas.height;
}

function getShader(id) {
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
    } else if (shaderScript.type == "x-shader/x-vertex") {
        shader = gl.createShader(gl.VERTEX_SHADER);
    } else {
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

function getProgram(fs_id, vs_id) {
    var fragmentShader = getShader(fs_id);
    var vertexShader = getShader(vs_id);

    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        alert("Could not initialise shaders");
    }

    program.vertexPositionAttribute = 
        gl.getAttribLocation(program, "aVertexPosition");

    program.pMatrixUniform = gl.getUniformLocation(program, "uPMatrix");
    program.mvMatrixUniform = gl.getUniformLocation(program, "uMVMatrix");

    return program;
}

var shaderPrograms = [];
var currentProgram = null;

function setShaderProgram(program) {
    if (currentProgram !== program) {
        currentProgram = program;
        gl.useProgram(currentProgram);

        // turn off all vertex attributes, draw operations need to turn the ones
        // they need back on
        //
        // if we don't do this, we see mysterious warnings from welgl on some
        // platforms due to unused attributes being left on
        var maxVSattribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        for (var i = 0; i < maxVSattribs; i++) {
            gl.disableVertexAttribArray(i);
        }
    }
}

var mvMatrix = mat4.create();
var mvMatrixStack = [];

function mvPushMatrix() {
    var copy = mat4.create();
    mat4.set(mvMatrix, copy);
    mvMatrixStack.push(copy);
}

function mvPopMatrix() {
    if (mvMatrixStack.length == 0) {
        throw "Invalid popMatrix!";
    }
    mvMatrix = mvMatrixStack.pop();
}

var pMatrix = mat4.create();

function setMatrixUniforms() {
    gl.uniformMatrix4fv(currentProgram.pMatrixUniform, false, pMatrix);
    gl.uniformMatrix4fv(currentProgram.mvMatrixUniform, false, mvMatrix);
}

// for clock-style arithmetic
function wrap_around(x, limit) {
    if (x > 0) {
        return x % limit;
    }
    else
        return ((x % limit) + limit) % limit;
}

// round n down to p boundary
function round_down(n, p) {
    return n - (n % p);
}

// round n up to p boundary
function round_up(n, p) {
    return round_down(n + p - 1, p);
}


function bufferCreate(type, data) {
    var buf = gl.createBuffer();
    gl.bindBuffer(type, buf);
    gl.bufferData(type, data, gl.STATIC_DRAW);

    return buf;
}

/* points is a 2D array of like [[x1, y1], [x2, y2], ..], make a 
 * draw buffer.
 */
function buffersCreate(points) {
    var vertex = [];
    for (var i = 0; i < points.length; i++) {
        vertex.push(points[i][0]);
        vertex.push(points[i][1]);
    }

    var vertex_buffer = 
        bufferCreate(gl.ARRAY_BUFFER, new Float32Array(vertex));
    vertex_buffer.itemSize = 2;
    vertex_buffer.numItems = points.length;

    return vertex_buffer;
}

/* Draw the thing made by buffersCreate() above.
 */
function buffersDraw(buffers) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers);
    gl.enableVertexAttribArray(currentProgram.vertexPositionAttribute);
    gl.vertexAttribPointer(currentProgram.vertexPositionAttribute, 
        buffers.itemSize, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINE_LOOP, 0, buffers.numItems);
};

/* points is a 2D array like [[x1, y1], [x2, y2], ..], make a pair of
 * draw buffers which will join pairs of points.
 */
function buffersCreateDiscontinuous(points) {
    if (points.length % 2 != 0) {
        console.log("buffersCreateDiscontinuous: not an even number of points");
    }

    var vertex = [];
    var index = [];
    for (var i = 0; i < points.length; i++) {
        vertex.push(points[i][0]);
        vertex.push(points[i][1]);
        index.push(i);
    }

    var vertex_buffer = 
        bufferCreate(gl.ARRAY_BUFFER, new Float32Array(vertex));
    vertex_buffer.itemSize = 2;
    vertex_buffer.numItems = points.length;

    var index_buffer = 
        bufferCreate(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(index));
    index_buffer.itemSize = 1;
    index_buffer.numItems = points.length;

    return [vertex_buffer, index_buffer];
}

/* Draw the thing made by buffersCreateDiscontinuous() above.
 */
function buffersDrawDiscontinuous(buffers) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers[0]);
    gl.enableVertexAttribArray(currentProgram.vertexPositionAttribute);
    gl.vertexAttribPointer(currentProgram.vertexPositionAttribute, 
            buffers[0].itemSize, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers[1]);
    gl.drawElements(gl.LINES, 
            buffers[1].numItems, gl.UNSIGNED_SHORT, 0);
};

function loadTexture(imgURL) {
    console.log("loadTexture: " + imgURL);

    var tex = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var img = new Image();
    img.src = imgURL;
    img.onload = function() {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 
        0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

        if (tex.onload) {
            tex.onload();
        }
    };

    return tex;
};
