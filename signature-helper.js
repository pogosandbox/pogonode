const POGOProtos    = require('node-pogo-protos');
const Random        = require("simjs-random");

var start = new Date().getTime();
var random = new Random();

var getRandomInt = function(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports.register = function(config, client) {
    if (client.hasOwnProperty("setSignatureInfos")) {        
        client.setSignatureInfos(function() {
            var timestamp_ms_since_start = new Date().getTime() - start;
            return {
                device_info: new POGOProtos.Networking.Envelopes.Signature.DeviceInfo({
                    device_id: config.device.id,
                    device_brand: "Apple",
                    device_model: "iPhone",
                    device_model_boot: "iPhone8,2",
                    hardware_manufacturer: "Apple",
                    hardware_model: "N66AP",
                    firmware_brand: "iPhone OS",
                    firmware_type: "9.3.5"
                }),

                activity_status: new POGOProtos.Networking.Envelopes.Signature.ActivityStatus({
                    stationary: true
                }),

                // sensor_info: new POGOProtos.Networking.Envelopes.Signature.SensorInfo({
                //     timestamp_snapshot: getRandomInt(timestamp_ms_since_start - 5000, timestamp_ms_since_start - 100),
                    // linear_acceleration_x: random.triangular(-3, 1, 0),
                    // linear_acceleration_y: random.triangular(-2, 3, 0),
                    // linear_acceleration_z: random.triangular(-4, 2, 0),
                    // magnetic_field_x: random.triangular(-50, 50, 0),
                    // magnetic_field_y: random.triangular(-60, 50, -5),
                    // magnetic_field_z: random.triangular(-60, 40, -30),
                    // magnetic_field_accuracy: [-1, 1, 1, 2, 2, 2, 2][Math.floor(Math.random()*7)],
                    // attitude_pitch: random.triangular(-1.5, 1.5, 0.2),
                    // attitude_yaw: random.uniform(-3, 3),
                    // attitude_roll: random.triangular(-2.8, 2.5, 0.25),
                    // rotation_rate_x: random.triangular(-6, 4, 0),
                    // rotation_rate_y: random.triangular(-5.5, 5, 0),
                    // rotation_rate_z: random.triangular(-5, 3, 0),
                    // gravity_x: random.triangular(-1, 1, 0.15),
                    // gravity_y: random.triangular(-1, 1, -.2),
                    // gravity_z: random.triangular(-1, .7, -0.8),
                    // status: 3

                    // magnetometer_x: random.triangular(-3, 1, 0),
                    // magnetometer_y: random.triangular(-2, 3, 0),
                    // magnetometer_z: random.triangular(-4, 2, 0),
                    // angle_normalized_x: random.triangular(-50, 50, 0),
                    // angle_normalized_y: random.triangular(-60, 50, -5),
                    // angle_normalized_z: random.triangular(-60, 40, -30),
                    // accel_raw_x: random.triangular(-1.5, 1.5, 0.2),
                    // accel_raw_y: random.uniform(-3, 3),
                    // accel_raw_z: random.triangular(-2.8, 2.5, 0.25),
                    // gyroscope_raw_x: random.triangular(-6, 4, 0),
                    // gyroscope_raw_y: random.triangular(-5.5, 5, 0),
                    // gyroscope_raw_z: random.triangular(-5, 3, 0),
                    // accel_normalized_x: random.triangular(-1, 1, 0.15),
                    // accel_normalized_y: random.triangular(-1, 1, -.2),
                    // accel_normalized_z: random.triangular(-1, .7, -0.8),
                    // accelerometer_axes: 3
                // })
            };
        });
    }
}
