var gphoto2 = require('gphoto2');
var GPhoto = new gphoto2.GPhoto2();
var gm = require('gm');
var fs = require('fs');
var http = require('http');
var childProcess = require('child_process');
var conf = require('./conf.json');

var Timelapse = require('./lib/timelapse');
var Camera = require('./lib/camera');
var emulatedCamera = require('./lib/camera-emulator');

/**
 * The controller object
 */
var Controller = function () {
    this.camera = null;
    this.server = null;
    this.timelapses = null;
    this.currentTimelapse = null;
    this.io = null;
    this.preview = null;
    this.socket = null;
}
// the folder where the pictures will be saved
Controller.WORKING_DIR = process.env.TIMELAPSE_DIR === 0 ? __dirname : process.env.TIMELAPSE_DIR;
Timelapse.WORKING_DIR = Controller.WORKING_DIR;

/**
 * Initilaize the object by getting the last timelapses and getting the connected camera
 */
Controller.prototype.init = function (callback) {
    (function (_this) {
        Timelapse.getFromDir(Controller.WORKING_DIR, function (tls) {
            _this.timelapses = tls;
            GPhoto.list(function (list) {
                //mini hack
                list = [emulatedCamera];
                if (list.length) {
                    gphotoCamera = list[0];
                    _this.camera = new Camera(gphotoCamera);
                    _this.camera.refreshConfig(callback);
                } else {
                    throw "No camera found";
                }
            });
        });
    })(this);

}

/**
 * Configure and start the socket server
 */
Controller.prototype.startServer = function (callback) {
    this.server = http.createServer(function (req, res) {
        res.end("OK", 200);
    });
    this.io = require('socket.io')(this.server);
    this.io.on('connection', this.onConnection.bind(this));
    this.server.listen(3000);
};

Controller.prototype.onConnection = function (socket) {
    // Prevent multiple connection
    if (this.socket) {
        socket.disconnect();
    } else {
        this.socket = socket;
        this.socket.emit("init", {camera: this.camera, conf: conf, timelapses: this.timelapses});
        this.socket.on('camera:takepicture', this.takePicture.bind(this));
        this.socket.on('disconnect', this.onDisconnect.bind(this));
        this.socket.on('camera:changeprop', this.changeProperty.bind(this));
        this.socket.on('timelapse:start', this.startTimelapse.bind(this));
        this.socket.on('timelapse:stop', this.stopTimelapse.bind(this));
    }
};

Controller.prototype.onDisconnect = function () {
    this.socket = null;
};

Controller.prototype.takePicture = function () {
    var path = Timelapse.WORKING_DIR + "/" + new Date().getTime() + "." + Timelapse.ext;
    this.camera.takePicture({download: true}, function (err1, data) {
        if (err1) this.socket.emit('camera:error', err1);
        if (this.preview === null) {
            this.savePicture(path, data);
        } else {
            this.removePreview(function (err) {
                if (err) throw err;
                this.savePicture(path, data);
            });
        }
    });
};

Controller.prototype.savePicture = function (path, data, callback) {
    this.preview = path;
    fs.writeFile(this.preview, data, function (err) {
        if (err) this.socket.emit('fs:error', err);
        gm(PUBLIC_DIR + previewLocation).options({imageMagick: true}).identify("%[mean]", function (err, mean) {
            //TODO send picture through socket
            var data = null;
            this.socket.emit("picture:preview", {data: data, mean: mean});
            callback(this.preview);
        });
    });
};
Controller.prototype.removePreview = function () {
    fs.unlink(Controller.WORKING_DIR + this.preview, function (err) {
        callback(err);
    });
};

Controller.prototype.changeProperty = function () {
    this.camera.changeProperty(function () {
        this.socket.emit('camera:config', this.camera.config);
    });
}

Controller.prototype.startTimelapse = function (options) {
    this.currentTimelapse = new Timelapse(new Date(), options.delay);
    this.currentTimelapse.setStep(tlPicture);
    this.currentTimelapse.start();
    this.camera.takePicture(function (err, data) {
        if (err) throw err;
        this.savePicture(this.currentTimelapse.nextPic(), data, function (path) {
            // Getting the picture brightness
            gm(path).options({imageMagick: true}).identify("%[mean]", function (err, mean) {
                //compare the brightness and correct
                if (mean < conf.MIN_BRIGHTNESS) {
                    // Increase shutter speed
                    console.log("Too dark");
                    var shutterId = this.config.shutterspeed.choices.indexOf(this.config.shutterspeed.value);
                    if (shutterId !== this.config.shutterspeed.choices.length - 1) {
                        var shutter = this.config.shutterspeed.choices[shutterId - 1];
                        this.changeProperty("shutterspeed", shutter, function (nConfig) {
                            this.currentTimelapse.schedule();
                            return;
                        });
                    }
                } else if (mean > conf.MAX_BRIGHTNESS) {
                    // Decrease shutter speed
                    console.log("Too bright");
                    var shutterId = this.config.shutterspeed.choices.indexOf(this.config.shutterspeed.value);
                    if (shutterId !== 0) {
                        var shutter = this.config.shutterspeed.choices[shutterId + 1];
                        this.changeProperty("shutterspeed", shutter, function (nConfig) {
                            this.currentTimelapse.schedule();
                            return;
                        });
                    }
                } else {
                    this.currentTimelapse.schedule();
                    return;
                }
            });
            // Auto gammaing the picture to remove all the little brightness bumps
            childProcess.exec('mogrify ' + "/Users/paul/Pictures/Timelapses/tl_1410025653246/2.jpg" + " -auto-gamma", function () {
                console.log(path + " mogrified");
            });
        });
    });
};

Controller.prototype.stopTimelapse = function () {
    this.currentTimelapse.stop();
    this.timelapses.push(this.currentTimelapse);
    this.currentTimelapse = null;
};

var ctrl = new Controller();
ctrl.init(function () {
    ctrl.startServer();
});
