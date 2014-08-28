var gphoto2 = require('gphoto2');
var GPhoto = new gphoto2.GPhoto2();
var fs = require('fs');
var http = require('http');
var monitor = require('usb-detection');
var childProcess = require('child_process');
var os = require('os');
var cameras = [];
var camera = null;
var config = null;

var server = http.createServer(function (req, res) {
    res.end("OK", 200);
});

var io = require('socket.io')(server);

io.on('connection', function (socket) {
    monitor.on('add', function (err, devices) {
        var onAdd = function () {
            var orig = cameras;
            detectCameras(function () {
                var added = findDifferent(orig, cameras);
                if (added !== null) {
                    console.log(added.model + ' added on port ' + added.port);
                    socket.emit("camera:add", {camera: added});
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
    monitor.on('remove', function (err, devices) {
        var orig = cameras;
        detectCameras(function () {
            var removed = findDifferent(orig, cameras);
            if (removed !== null) {
                console.log(removed.model + " removed from port " + removed.port);
                socket.emit("camera:remove", {camera: removed});
            }
        });
    });
    socket.emit("cameras", {cameras: cameras});
    socket.on('select:camera', function (options) {
        camera = cameras[options.index];
        camera.getConfig(function (err, settings) {
            if (err) {
                socket.emit("error", err);
            } else {
                config = settings.main.children.capturesettings.children;
                socket.emit("config", config);
            }
        });
    });
    socket.on('picture', function () {
        console.log('TAKE');
        camera.takePicture({download: true}, function (err, data) {
            fs.writeFileSync(__dirname + "/picture.jpg", data);
        });
    });
    socket.on('aperture-change', function (msg) {
        console.log(msg.value);
        camera.setConfigValue('aperture', msg.value+"", function (err) {
            camera.getConfig(function (err, settings) {
                config = settings.main.children.capturesettings.children;
            });
        });
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
        for (var i = 0, len = cameras.length; i < len; i += 1) {
            console.log(cameras[i]);
        }
        callback(list);
    });
}
function findDifferent (first, second) {
    console.log(first);
    console.log(second);
    // First, we check if the first is longer than the second
    if (first.length < second.length) {
        // If not, we switch them
        var buf = first;
        first = second;
        second = buf
    }
    if (first.length === 1 && second.length === 0) return first[0];
    var f = null,
        s = null;
    for (var i = 0, len = first.length; i < len; i += 1) {
        f = first[i];
        for (var j = 0, ler = second.length; j < ler; j += 1) {
            s = second[j];
            if (f.port === s.port) {
                break;
            }
        }
        return f;
    }
    return null;
}
