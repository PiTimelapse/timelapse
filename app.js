var gphoto2 = require('gphoto2');
var GPhoto = new gphoto2.GPhoto2();
var fs = require('fs');
var http = require('http');
var camera = null;
var config = null;

var server = http.createServer(function (req, res) {
    res.end("OK", 200);
});

var io = require('socket.io')(server);

io.on('connection', function (socket) {
    console.log("Connected: " + socket);
    socket.emit("config", config);
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

GPhoto.list(function (list) {
    if (list.length === 0) return;
    camera = list[0];
    console.log("Found: " + camera.model);
    camera.getConfig(function (err, settings) {
        fs.writeFileSync(__dirname + "/set.json", JSON.stringify(settings));
        config = settings.main.children.capturesettings.children;
        server.listen(3000, function () {
            console.log("Listening on port 3000");
        });
    });
});
