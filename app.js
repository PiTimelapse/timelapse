var gphoto2 = require('gphoto2');
var GPhoto = new gphoto2.GPhoto2();
var gm = require('gm');
var fs = require('fs');
var http = require('http');
var childProcess = require('child_process');
var conf = require('./conf.json');
var monitor = require('usb-detection');
var os = require('os');

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
Controller.prototype.init = function () {
    (function (_this) {
        Timelapse.getFromDir(Controller.WORKING_DIR, function (tls) {
            _this.timelapses = tls;
            monitor.on('add', _this.onUsbChanged.bind(_this));
            monitor.on('remove', _this.onUsbChanged.bind(_this));
            _this.onUsbChanged();
        });
    })(this);
}

Controller.prototype.onUsbChanged = function () {
    if (os.platform() === "darwin") {
        childProcess.exec('killall PTPCamera', this.checkCamera.bind(this));
    } else {
        this.checkCamera();
    }
};

Controller.prototype.checkCamera = function () {
    (function (_this) {
        GPhoto.list(function (list) {
            //mini hack
            //list = [emulatedCamera];
            if (list.length) {
                gphotoCamera = list[0];
                _this.camera = new Camera(gphotoCamera);
                _this.camera.refreshConfig();
                if (_this.socket) {
                    _this.socket.emit("camera", {camera: _this.camera});
                }
                console.log('Camera detected: ' + _this.camera.gphotoObject.model);
            } else {
                _this.camera = null;
                if (_this.socket) {
                    _this.socket.emit("nocamera");
                }
                console.log("Camera not present");
            }
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
    console.log("Server started on port 3000");
};

Controller.prototype.onConnection = function (socket) {
    console.log("Client connected: " + socket.handshake.headers.host);
    // Prevent multiple connection
    if (this.socket) {
        socket.disconnect();
        console.log("Client denied, only one at a time");
    } else {
        this.socket = socket;
        if (this.camera !== null){
            this.socket = socket;
            var tl = this.currentTimelapse && this.currentTimelapse.running ? {photoNb: this.currentTimelapse.pictures.length} : null;
            this.socket.emit("init", {camera: this.camera, conf: conf, timelapses: this.timelapses, currentTimelapse: tl});
            this.socket.on('camera:takepicture', this.takePicture.bind(this));
            this.socket.on('camera:changeprop', this.changeProperty.bind(this));
            this.socket.on('timelapse:start', this.startTimelapse.bind(this));
            this.socket.on('timelapse:stop', this.stopTimelapse.bind(this));
        } else {
            this.socket.emit("nocamera");
        }
        this.socket.on('disconnect', this.onDisconnect.bind(this));
    }
};

Controller.prototype.onDisconnect = function () {
    console.log("Client disconected: " + this.socket.handshake.headers.host + ". Bye !")
    this.socket = null;
};

Controller.prototype.takePicture = function () {
    var path = Timelapse.WORKING_DIR + "/" + new Date().getTime() + "." + Timelapse.ext;
    this.camera.takePicture({download: true}, function (err1, data) {
        if (err1) this.io.emit('camera:error', err1);
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
    (function (_this) {
        fs.writeFile(_this.preview, data, function (err) {
            if (err) _this.socket.emit('fs:error', err);
            gm(_this.preview).options({imageMagick: true}).identify("%[mean]", function (err, mean) {
                //TODO send picture through socket
                var data = null;
                _this.io.emit("picture:preview", {data: data, mean: mean});
                callback(_this.preview);
            });
        });
    })(this);
};
Controller.prototype.removePreview = function () {
    fs.unlink(Controller.WORKING_DIR + this.preview, function (err) {
        callback(err);
    });
};

Controller.prototype.changeProperty = function (options, callback) {
    (function (_this) {
        _this.camera.changeProperty(options.prop, options.value, function () {
            _this.io.emit('camera:config', _this.camera.config);
            callback();
        });
    })(this);
}

Controller.prototype.startTimelapse = function (options) {
    if (this.currentTimelapse === null || !this.currentTimelapse.running) {
        this.currentTimelapse = new Timelapse(new Date(), options.delay);
        this.currentTimelapse.setStep(this.tlPicture.bind(this));
        this.currentTimelapse.start();
        this.io.emit('timelapse:start');
    } else {
        this.info("Timelapse already running");
    }
};

Controller.prototype.tlPicture = function () {
    (function (_this) {
        _this.camera.takePicture(function (err, data) {
            if (err) {
                _this.io.emit("camera:error", err);
                return;
            }
            _this.savePicture(_this.currentTimelapse.nextPic(), data, function (path) {
                _this.io.emit("timelapse:picture");
                _this.correctBrightness(path, _this.currentTimelapse.schedule.bind(_this.currentTimelapse));
                // Auto gammaing the picture to remove all the little brightness bumps
                childProcess.exec('mogrify ' + path + " -auto-gamma", function (error, stdout, stderr) {
                    console.log(path + " mogrified");
                });
            });
        });
    })(this);
};

Controller.prototype.correctBrightness = function (path, callback) {
    (function (_this) {
        // Getting the picture brightness
        gm(path).options({imageMagick: true}).identify("%[mean]", function (err, mean) {
            //compare the brightness and correct
            if (mean < conf.MIN_BRIGHTNESS) {
                // Increase shutter speed
                console.log("Brightness correction: Too dark");
                var shutterId = _this.camera.config.shutterspeed.choices.indexOf(_this.camera.config.shutterspeed.value);
                if (shutterId !== _this.camera.config.shutterspeed.choices.length - 1) {
                    var shutter = _this.camera.config.shutterspeed.choices[shutterId - 1];
                    _this.changeProperty({prop: "shutterspeed", value: shutter}, function (nConfig) {
                        _this.info("Picture too dark, shutter speed changed to " + shutter);
                        callback();
                        return;
                    });
                }
            } else if (mean > conf.MAX_BRIGHTNESS) {
                // Decrease shutter speed
                console.log("Brightness correction: Too bright");
                var shutterId = _this.camera.config.shutterspeed.choices.indexOf(_this.camera.config.shutterspeed.value);
                if (shutterId !== 0) {
                    var shutter = _this.camera.config.shutterspeed.choices[shutterId + 1];
                    _this.changeProperty({prop: "shutterspeed", value: shutter}, function (nConfig) {
                        _this.info("Picture too bright, shutter speed changed to " + shutter);
                        callback();
                        return;
                    });
                }
            } else {
                callback();
                return;
            }
        });
    })(this);

}

Controller.prototype.stopTimelapse = function () {
    if (this.currentTimelapse !== null && this.currentTimelapse.running) {
        this.currentTimelapse.stop();
        this.timelapses.push(this.currentTimelapse);
        this.io.emit("timelapse:stop");
    } else {
        this.info("No timelapse is running");
    }
};

Controller.prototype.info = function (msg) {
    console.log(msg);
    this.io.emit('tl:info', msg);
}

var ctrl = new Controller();
ctrl.init();
ctrl.startServer();
