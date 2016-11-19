const Random        = require("simjs-random");

var start = new Date().getTime();
var random = new Random();

var getRandomInt = function(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports.register = function(config, client) {
    if (client.hasOwnProperty("setSignatureInfos")) {        
        client.setSignatureInfos(function(envelope) {
            var timestamp_ms_since_start = new Date().getTime() - start;
            
            var infos = {};

            var loc = {
                          provider: ['network', 'network', 'network', 'network', 'fused'][Math.floor(Math.random()*5)],
                          latitude: client.playerLatitude,
                          longitude: client.playerLongitude,
                          altitude: random.triangular(300, 400, 350),
                          provider_status: 3,
                          location_type: 1
                      };
            if (envelope.accuracy >= 65) {
                loc.vertical_accuracy = random.triangular(35, 100, 65);
                loc.horizontal_accuracy = [envelope.accuracy, 65, 65, random.uniform(66,80), 200][Math.floor(Math.random()*5)];
            } else if (envelope.accuracy > 10) {
                loc.horizontal_accuracy = envelope.accuracy;
                loc.vertical_accuracy = [24, 32, 48, 48, 64, 64, 96, 128][Math.floor(Math.random()*8)];
            } else {
                loc.horizontal_accuracy = envelope.accuracy;
                loc.vertical_accuracy = [3, 4, 6, 6, 8, 12, 24][Math.floor(Math.random()*8)];
            }

            infos.location_fix = [new client.POGOProtos.Networking.Envelopes.Signature.LocationFix(loc)];

            infos.device_info = new client.POGOProtos.Networking.Envelopes.Signature.DeviceInfo({
                                    device_id: config.device.id,
                                    device_brand: "Apple",
                                    device_model: "iPhone",
                                    device_model_boot: "iPhone8,2",
                                    hardware_manufacturer: "Apple",
                                    hardware_model: "N66AP",
                                    firmware_brand: "iPhone OS",
                                    firmware_type: "9.3.5"
                                });

            infos.activity_status = new client.POGOProtos.Networking.Envelopes.Signature.ActivityStatus({
                                        stationary: true
                                    });

            infos.sensor_info = [new client.POGOProtos.Networking.Envelopes.Signature.SensorInfo({
                timestamp_snapshot: getRandomInt(timestamp_ms_since_start - 5000, timestamp_ms_since_start - 100),
                linear_acceleration_x: random.triangular(-3, 1, 0),
                linear_acceleration_y: random.triangular(-2, 3, 0),
                linear_acceleration_z: random.triangular(-4, 2, 0),
                magnetic_field_x: random.triangular(-50, 50, 0),
                magnetic_field_y: random.triangular(-60, 50, -5),
                magnetic_field_z: random.triangular(-60, 40, -30),
                magnetic_field_accuracy: [-1, 1, 1, 2, 2, 2, 2][Math.floor(Math.random()*7)],
                attitude_pitch: random.triangular(-1.5, 1.5, 0.2),
                attitude_yaw: random.uniform(-3, 3),
                attitude_roll: random.triangular(-2.8, 2.5, 0.25),
                rotation_rate_x: random.triangular(-6, 4, 0),
                rotation_rate_y: random.triangular(-5.5, 5, 0),
                rotation_rate_z: random.triangular(-5, 3, 0),
                gravity_x: random.triangular(-1, 1, 0.15),
                gravity_y: random.triangular(-1, 1, -.2),
                gravity_z: random.triangular(-1, .7, -0.8),
                status: 3
            })];
            
            return infos;
        });
    }
}
