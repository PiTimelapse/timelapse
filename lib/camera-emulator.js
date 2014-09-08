var conf = {
    main: {
        children: {
            capturesettings: {
                children: {
                    shutterspeed: {
                        choices: ["1/1000", "1/800", "bulb"],
                        value: "1/800",
                        label: "Shutter Speed",
                        type: "choice"
                    },
                    aperture: {
                        choices: ["5.6", "16", "22"],
                        value: "16",
                        label: "Aperture",
                        type: "choice"
                    }
                }
            }
        }
    }
};
module.exports = {
    getConfig: function (callback) {
        callback(null, conf);
    },
    setConfigValue: function (name, value, callback) {
        conf.main.children.capturesettings.children[name] = value;
    },
    model: "Canon EOS 550D"
}
