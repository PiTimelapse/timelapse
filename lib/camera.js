var gphoto2 = require('gphoto2');
var GPhoto = new gphoto2.GPhoto2();

var Camera = function (gphoto) {
    this.gphotoObject = gphoto;
    this.config = null;
}

Camera.prototype.refreshConfig = function (callback) {
    (function (_this) {
        _this.gphotoObject.getConfig(function (err, settings) {
            _this.config = settings.main.children.capturesettings.children
            for (key in this.config) {
                console.log(this.config[key]);
                if (_this.config[key].choices) {
                    _this.config[key].choices = _this.config[key].choices.map(function (item) {
                        if (item.toLowerCase().indexOf("unknown") !== -1) {
                            return [];
                        }
                        return item;
                    });
                }
            }
            callback(err);
        });
    })(this);

};

Camera.prototype.takePicture = function () {
    this.gphotoObject.takePicture(arguments);
}
Camera.prototype.changeProperty = function (name, value, callback) {
    this.gphotoObject.setConfigValue(name, value, function (err) {
        this.refreshConfig(callback);
    });
}
module.exports = Camera;
