var gphoto2 = require('gphoto2');
var GPhoto = new gphoto2.GPhoto2();
var gm = require('gm');
var fs = require('fs');
var http = require('http');
var childProcess = require('child_process');
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
    this.preview = "preview" + Timelapse.ext;
    this.socket = null;
    this.conf = require('./conf.json');
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
    (function (_this) {
        _this.server = http.createServer(function (req, res) {
            if (req.url.substr(req.url.length - 3) === "pic") {
                console.log('read');
                fs.readFile(_this.preview, function (err, data) {
                    if (err) {
                        res.end("OK", 200);
                    } else {
                        res.writeHead(200, {'Content-Type': 'image/'+Timelapse.ext});
                        res.end(data);
                    }
                });
            }
        });
        _this.io = require('socket.io')(_this.server);
        _this.io.on('connection', _this.onConnection.bind(_this));
        _this.server.listen(3000);
        console.log("Server started on port 3000");
    })(this);
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
            this.socket.emit("init", {camera: this.camera, conf: this.conf, timelapses: this.timelapses, currentTimelapse: tl});
            this.socket.on('camera:takepicture', this.takePicture.bind(this));
            this.socket.on('camera:changeprop', this.changeProperty.bind(this));
            this.socket.on('timelapse:start', this.startTimelapse.bind(this));
            this.socket.on('timelapse:stop', this.stopTimelapse.bind(this));
            this.socket.on('advanced:change', this.changeConf.bind(this));
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

Controller.prototype.changeConf = function (conf) {
    this.conf = conf;
    fs.writeFile('conf.json', JSON.stringify(conf));
    this.io.emit('info', "Advanced options updated");
};

Controller.prototype.takePicture = function () {
    var path = "preview." + Timelapse.ext;
    (function (_this) {
        _this.camera.takePicture(function (err1, data) {
            if (err1) _this.io.emit('camera:error', err1);
            _this.removePreview(function (err) {
                _this.savePicture(path, data);
            });
        });
    })(this);
};

Controller.prototype.savePicture = function (path, data, callback) {
    callback = callback || function () {};
    this.preview = path;
    (function (_this) {
        _this.perf("Start writing");
        var start = new Date();
        fs.writeFile(_this.preview, data, function (err) {
            _this.perf('End writing');
            if (err) _this.socket.emit('fs:error', err);
            _this.perf('Start identify');
            gm(_this.preview).options({imageMagick: true}).identify("%[mean]", function (err, mean) {
                _this.perf('End identify');
                var end = new Date(),
                    delay = end - start;
                _this.io.emit("picture:preview", {mean: mean, delay: delay + Math.max(0, _this.currentTimelapse.interval - delay)});
                callback(_this.preview, mean, delay);
            });
        });
    })(this);
};
Controller.prototype.removePreview = function (callback) {
    callback = callback || function () {};
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
    console.log(options);
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
            // If there is an error while taking the picture, schedule the next try with the same file name
            if (err) {
                _this.io.emit("camera:error", "An error occured while taking the picture, maybe it's the autofocus");
                _this.currentTimelapse.step();
                return;
            }
            _this.savePicture(_this.currentTimelapse.nextPic(), data, function (path, mean, delay) {
                _this.io.emit("timelapse:picture");
                _this.correctBrightness(path, mean, _this.currentTimelapse.schedule.bind(_this.currentTimelapse, delay));
                // Auto gammaing the picture to remove all the little brightness bumps
                childProcess.exec('mogrify ' + path + " -auto-gamma", function (error, stdout, stderr) {
                    console.log(path + " mogrified");
                });
            });
        });
    })(this);
};

Controller.prototype.correctBrightness = function (path, mean, callback) {
    (function (_this) {
        //compare the brightness and correct
        if (mean < parseInt(_this.conf.MIN_BRIGHTNESS)) {
            // Increase shutter speed
            console.log("Brightness correction: Too dark");
            var shutterId = _this.camera.config[_this.conf.BRIGHTNESS_DRIVER].choices.indexOf(_this.camera.config[_this.conf.BRIGHTNESS_DRIVER].value);
            if (shutterId !== _this.camera.config[_this.conf.BRIGHTNESS_DRIVER].choices.length - 1) {
                var shutter = _this.camera.config[_this.conf.BRIGHTNESS_DRIVER].choices[shutterId - 1];
                _this.changeProperty({prop: _this.conf.BRIGHTNESS_DRIVER, value: shutter}, function (nConfig) {
                    _this.info("Picture too dark, " + _this.camera.config[_this.conf.BRIGHTNESS_DRIVER].label+" changed to " + shutter);
                    callback();
                    return;
                });
            }
        } else if (mean > parseInt(_this.conf.MAX_BRIGHTNESS)) {
            // Decrease shutter speed
            console.log("Brightness correction: Too bright");
            var shutterId = _this.camera.config[_this.conf.BRIGHTNESS_DRIVER].choices.indexOf(_this.camera.config[_this.conf.BRIGHTNESS_DRIVER].value);
            if (shutterId !== 0) {
                var shutter = _this.camera.config[_this.conf.BRIGHTNESS_DRIVER].choices[shutterId + 1];
                _this.changeProperty({prop: _this.conf.BRIGHTNESS_DRIVER, value: shutter}, function (nConfig) {
                    _this.info("Picture too bright, " + _this.camera.config[_this.conf.BRIGHTNESS_DRIVER].label + " changed to " + shutter);
                    callback();
                    return;
                });
            }
        } else {
            callback();
            return;
        }
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
};
Controller.prototype.perf = function (msg) {
    console.log('PERF: '+msg);
};

var ctrl = new Controller();
ctrl.init();
ctrl.startServer();
