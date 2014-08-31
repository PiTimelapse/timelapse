var gphoto2 = require('gphoto2');
var GPhoto = new gphoto2.GPhoto2();
var gm = require('gm');
var fs = require('fs');
var http = require('http');
var monitor = require('usb-detection');
var childProcess = require('child_process');
var os = require('os');
var cameras = [];
var camera = null;
var config = null;
var tl = null;
var timelapses = [],
    previewLocation = null,
    PUBLIC_DIR = "/Users/paul/workspace/timelapse-webclient/public",
    meanBrightness = null,
    conf = require('./conf.json');

fs.readdir(PUBLIC_DIR, function (err, files) {
    var splitter = null;
    for (var i = 0; i < files.length; i += 1) {
        if (typeof files[i] == "undefined") {
            files.splice(i, 1);
        }
        splitter = files[i].split('.');
        if (splitter[splitter.length - 1] !== "jpg") {
            files.splice(i, 1);
        }
    }
    if (files.length > 0) {
        previewLocation = "/" + files[0];
    }
});

var server = http.createServer(function (req, res) {
    res.end("OK", 200);
});

var io = require('socket.io')(server);

io.on('connection', function (socket) {
    socket.emit("init", {cameras: cameras, previewLocation: previewLocation, conf: conf});
    socket.on('camera:select', function (options) {
        camera = findByPort(options.camera, cameras);
        camera.getConfig(function (err, settings) {
            if (err) {
                socket.emit("error", err);
            } else {
                config = settings.main.children.capturesettings.children;
                socket.emit("camera:config", config);
            }
        });
    });
    socket.on('camera:takepicture', function () {
        camera.takePicture({download: true}, function (err1, data) {
            if (err1) socket.emit('error', err1);
            var savePicture = function () {
                previewLocation = "/" + new Date().getTime() + ".jpg";
                fs.writeFile(PUBLIC_DIR + previewLocation, data, function (err3) {
                    if (err3) socket.emit('error', err3);
                    gm(PUBLIC_DIR + previewLocation).options({imageMagick: true}).identify("%[mean]", function (err, data) {
                        socket.emit('picture:preview', {location: previewLocation, meanBrightness: data});
                    });
                });
            }
            if (previewLocation === null) {
                savePicture();
            } else {
                fs.unlink(PUBLIC_DIR + previewLocation, function (err2) {
                    if (err2) socket.emit('error', err2);
                    savePicture();
                });
            }
        });
    });
    socket.on('camera:changeprop', function (options) {
        console.log(options.value);
        camera.setConfigValue(options.prop, options.value+"", function (err) {
            camera.getConfig(function (err, settings) {
                config = settings.main.children.capturesettings.children
                for (key in config) {
                    if (config[key].choices) {
                        config[key].choices = config[key].choices.map(function (item) {
                            if (item.toLowerCase().indexOf("unknown") !== -1) {
                                return [];
                            }
                            return item;
                        });
                    }
                }
                socket.emit("camera:config", config);
            });
        });
    });
    socket.on('timelapse:start', function (options) {
        var location = PUBLIC_DIR + "/" + new Date().getTime(),
            id = 0;
        fs.mkdir(location, function (err) {
            tl = setInterval(function () {
                camera.takePicture({download: true}, function (err, data) {
                    if (err) socket.emit('error', err);
                    id += 1;
                    var filename = location + "/" + id + ".jpg";
                    fs.writeFile(filename, data, function (err) {
                        if (err) socket.emit("error", err);
                        gm(filename).options({imageMagick: true}).identify("-format %[mean]", function (err, mean) {
                            if (meanBrightness !== null) {
                                //compare the brightness and correct
                                if (mean < conf.MIN_BRIGHTNESS) {
                                    // Increase shutter speed
                                } else if (mean > conf.MAX_BRIGHTNESS) {
                                    // Decrease shutter speed
                                }
                            }
                            meanBrightness = mean;
                        });
                    });
                });
            }, options.delay * 1000);
        });
    });
    socket.on('timelapse:stop', function () {
        clearInterval(tl);
    });
});

monitor.on('add', function (device) {
    var onAdd = function () {
        detectCameras(function () {
            var added = findCamera(device, cameras);
            if (added !== null) {
                console.log(added.model + ' added on port ' + added.port);
                io.emit("camera:add", {camera: added});
            }
        });
    };
    setTimeout(function () {
        if (os.platform() === "darwin") {
            childProcess.exec('killall PTPCamera', onAdd);
        } else {
            onAdd();
        }
    }, 1000);
});
monitor.on('remove', function (device) {
    var orig = cameras;
    detectCameras(function () {
        var removed = findCamera(device, orig);
        if (removed !== null) {
            console.log(removed.model + " removed from port " + removed.port);
            io.emit("camera:remove", {camera: removed});
        }
    });
});

detectCameras(function () {
    server.listen(3000, function () {
        console.log("Listening on port 3000");
    });
});

function detectCameras (callback) {
    GPhoto.list(function (list) {
        cameras = list;
        callback(list);
    });
}
function findCamera (needle, stack) {
    var split = null,
        port = null;
    for (var i = 0, len = stack.length; i < len; i += 0) {
        split = stack[i].port.split(',');
        port = parseInt(split[split.length - 1]);
        if (port === needle.deviceAddress) {
            return stack[i];
        }
    }
    return null;
};
function findByPort (needle, stack) {
    for (var i = 0, len = stack.length; i < len; i += 0) {
        if (needle.port === needle.port) {
            return stack[i];
        }
    }
    return null;
}
