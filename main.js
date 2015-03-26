'use strict';

var view = null;

function attach_view() {
    var canvas = document.getElementById("viewer");

    view = new View(canvas, "nina");
}
