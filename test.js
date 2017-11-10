var mqtt = require('mqtt');
var client  = mqtt.connect('mqtt://ordervis02.local');

client.on('connect', function () {
	  client.subscribe('levelup/visualization/order')
});

client.on('message', function (topic, message) {
// message is Buffer
   console.log(message.toString())
});
