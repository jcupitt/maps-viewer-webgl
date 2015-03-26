/* Simple test harness for ArghView.
 */

'use strict';

var View = function(canvas, basename) {
    this.canvas = canvas;
    this.basename = basename;

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

        this.arghview = new ArghView(canvas,
            this.tileURL.bind(this), 
            {w: this.properties.width, h: this.properties.height},
            {w: this.tile_size, h: this.tile_size},
            this.n_layers);

        // fetch tiles for this view
        this.arghview.setLayer(6); 
        this.arghview.fetch(); 
    };

    this.left_down = false;
    canvas.addEventListener('mousedown', function(event) {
        if (event.button == 0) {
            var pos = this.arghview.getPosition();

            this.left_down = true;
            this.drag_start_left = event.clientX;
            this.drag_start_top = event.clientY;
            this.drag_start_viewport_left = pos.x;
            this.drag_start_viewport_top = pos.y;
        }
    }.bind(this));
    canvas.addEventListener('mouseup', function(event) {
        if (event.button == 0) {
            this.left_down = false;
        }
    }.bind(this));
    canvas.addEventListener('mouseleave', function(event) {
        this.left_down = false;
    }.bind(this));
    canvas.addEventListener('mousemove', function(event) {
        if (this.left_down) {
            var relative_x = event.clientX - this.drag_start_left;
            var relative_y = event.clientY - this.drag_start_top;
            var new_x = this.drag_start_viewport_left - relative_x;
            var new_y = this.drag_start_viewport_top - relative_y;

            this.arghview.setPosition(new_x, new_y);
            this.arghview.fetch();
        }
    }.bind(this));
    canvas.addEventListener('mousewheel', function(event) {
        this.mousewheel(event);
    }.bind(this), false);
    // different name in ff
    canvas.addEventListener('DOMMouseScroll', function(event) {
        this.mousewheel(event);
    }.bind(this), false);
};

View.prototype.constructor = View;

View.prototype.mousewheel = function(event) {
    // cross-browser wheel delta
    var delta = Math.max(-1, Math.min(1, (event.wheelDelta || -event.detail)));

    var layer = this.arghview.layer;
    var x = (event.clientX + this.arghview.viewport_left) * 
        this.arghview.layer_properties[layer].shrink;
    var y = (event.clientY + this.arghview.viewport_top) *
        this.arghview.layer_properties[layer].shrink;

    layer += delta;
    this.setLayer(layer);
    layer = this.arghview.layer;

    var new_x = x / this.arghview.layer_properties[layer].shrink - event.clientX;
    var new_y = y / this.arghview.layer_properties[layer].shrink - event.clientY;
    this.setPosition(new_x, new_y); 

    this.arghview.fetch();

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

View.prototype.tileURL = function(z, x, y) {
    return this.basename + "/" + z + "/" + y + "/" + x + ".jpg";
};

View.prototype.setLayer = function(layer) {
    this.arghview.setLayer(layer);
}

View.prototype.setPosition = function(x, y) {
    this.arghview.setPosition(x, y);
}
