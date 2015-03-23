'use strict';

var view = null;

function attach_view() {
    var canvas = document.getElementById("viewer");

    view = new View(canvas, "nina");
    view.setLayer(0);
    view.setPosition(0, 0);
}
