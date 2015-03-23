'use strict';

var view = null;

function attach_view() {
    var canvas = document.getElementById("viewer");

    view = new View(canvas, "nina");
    view.setLayer(3);
    view.setPosition(0, 0);
    view.draw(); 
}
