var fs = require('fs');

Date.prototype.isValid = function () {
    return isFinite(this);
}

function pad (str, max) {
  return str.length < max ? pad("0" + str, max) : str;
}

var isDir = function (path) {
    return fs.statSync(path).isDirectory();
}
/**
 * Get the picture list from a given abspath, with a given extension
 */
var getPictures = function (dir, ext) {
    var files = fs.readdirSync(dir),
        split = null;
    for (var i = 0; i < files.length; i += 1) {
        split = (files[i]+"").split('.');
        if (split.length === 0 || split[split.length - 1] !== ext) {
            files.splice(i, 1);
            i--;
        }
    }
    return files;
}
var Timelapse = function (date, interval) {
    this.date = date;
    this.pictures = [];
    this.timeout = null;
    this.interval = interval * 1000;
    this.running = false;
    this.step = null;
};
Timelapse.prefix = "tl_";
Timelapse.ext = "jpg";
Timelapse.pad = 5;
Timelapse.prototype.setPictures = function (pictures) {
    this.pictures = pictures;
    fs.mkdirSync(this.getDir());
};
/**
 * Read the given abspath and find all the saved timelapses
 */
Timelapse.getFromDir = function (dir, callback) {
    fs.readdir(dir, function (err, files) {
        var date = null,
            pictures = null;
        if (err) throw err;
        for (var i = 0; i < files.length; i += 1) {
            // Removing all the files and the folders not begining with the prefix
            if (!isDir(dir + "/" + files[i]) || files[i].substr(0, 3) !== Timelapse.prefix) {
                files.splice(i, 1);
                i--;
            } else {
                // Removing the malformed date in the folder name
                date = new Date((files[i].substr(3, files[i].length - 2))*1);
                if (!date.isValid()) {
                    files.splice(i, 1);
                    i--;
                } else {
                    // Getting the pictures and building the Timelapse objects
                    pictures = getPictures(dir + "/" + files[i], Timelapse.ext);
                    files[i] = new Timelapse(date, pictures);
                }
            }
        }
        callback(files);
    });
};

Timelapse.prototype.getDir = function () {
    return Timelapse.WORKING_DIR + "/" + Timelapse.prefix + this.date.getTime();
};

Timelapse.prototype.nextPic = function () {
    var path = this.getDir() + "/" + pad((this.pictures.length + 1) + "", Timelapse.pad) + "." + Timelapse.ext;
    this.pictures.push(path);
    return path;
};

Timelapse.prototype.start = function () {
    this.started = true;
}

Timelapse.prototype.schedule = function (timeout) {
    if (this.running) {
        this.timeout = setTimeout(this.step, this.interval);
    }
};

Timelapse.prototype.stop = function () {
    this.running = false;
    clearTimeout(this.timeout);
    fs.writeFile(this.getDir() + "/tovideo", "ffmpeg -f image2 -r " + this.interval + " -i img%0" + Timelapse.pad + "d.jpg -vf \"fps=25,scale=1080:-1\" timelapse.mp4")
};

Timelapse.prototype.setStep = function (func) {
    this.step = func;
}

module.exports = Timelapse;
