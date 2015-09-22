var crypto = require('crypto')
var util         = require("util");
var EventEmitter = require('events').EventEmitter;
var types = require("HAP-NodeJS/accessories/types.js");
var request = require("request");
var mosca = require('mosca');
var _ = require('lodash');

var MqttPlatform = function(log, config){
  EventEmitter.call(this);
  that = this;
  this.dontUseBridged = true;
  this.log          = log;
  this.app_id       = config["app_id"];
  this.access_token = config["access_token"];

  this.mqttServer = new mosca.Server({
    port: 1883,
  });

  this.mqttServer.on('ready', function() {
    console.log('Mosca server is up and running');
    this.authenticate = function(client, username, password, callback) {
      var authorized = (username === 'inon' && password.toString() === 'inon');
      if (authorized) client.user = username;
      callback(null, authorized);
    };
  });

  this.mqttServer.on('clientConnected', function (client) {
    that.log("New device:",client.id);

    var hash = crypto.createHash('md5').update(client.id).digest('hex');
    var iid = hash.substr(0,12).toUpperCase().match(/.{1,2}/g).join(":");

    var mockedInfo = {
      iid: iid,
      mqttId: client.id,
      name: 'Garage Door',
    };

    accessory = new MqttAccessory(mockedInfo, that.log);
    that.foundAccessories.push(accessory);
    that.emit("addAccessory",accessory);
/*
    s = {
      mqttId: client.id+'a',
      name: 'Porch light2',
      commands: {
        'on': function() {
          console.log("turning on");
          var newPacket = {
            topic: '/ESP8266-16050303',
            payload: 'closeDoor'
          };
          that.mqttServer.publish(newPacket);
        },
        'off': function() {

        }
      },
      state: {
        'on':false
      }
    }
    accessory2 = new MqttAccessory(s.mqttId, that.log, s.name, s.commands, s.state);
    that.foundAccessories.push(accessory2);
    that.emit("addAccessory",accessory2);    
*/
  });

  this.mqttServer.on('clientDisconnected', function (client) {
    that.log("device disconnected:",client.id);
    var i = _.findIndex(that.foundAccessories, function(accessory) {
      return accessory.mqttId == client.id;
    });
    if (i>-1) {
      var accessory = that.foundAccessories[i];
      that.emit("removeAccessory",accessory);
      that.foundAccessories.splice(i,1);
    };
  });

  this.mqttServer.on('published', function (packet, client) {
    console.log("Published :=", packet);
    if (!client) return;
    var payload = packet.payload.toString('utf8');
    var i = _.findIndex(that.foundAccessories, function(accessory) {
      return accessory.mqttId == client.id;
    });
    if (i>-1) {
      if (payload == 'doorClosed' || payload == 'doorOpened') {
        var value = (payload =='doorOpened') ? 0 : 1;
        that.foundAccessories[i].initialized = false;
        that.foundAccessories[i].currentStateCharacteristic.updateValue(value, null);
        that.foundAccessories[i].targetStateCharacteristic.updateValue(value, null);
      }
    }
  });

}

util.inherits(MqttPlatform, EventEmitter);

MqttPlatform.prototype.closeServer = function() {
  this.mqttServer.close(function() {console.log("mosca closed");});
}

MqttPlatform.prototype.accessories = function(callback) {
  var that = this;
  if (!this.foundAccessories) {
    this.foundAccessories=[];
  }
  callback(this.foundAccessories);
}

function MqttAccessory(conf, log) {
  // device info

  this.name     = conf.name;
  this.commands = conf.commands;
  this.state    = conf.state;
  this.mqttId    = conf.mqttId;
  this.iid    = conf.iid;
  this.log      = log;

  this.currentStateCharacteristic = undefined;
  this.targetStateCharacteristic = undefined;
}

MqttAccessory.prototype = {

  sendMqttCommand: function(topic,payload) {
    var newPacket = {
      topic: '/'+topic,
      payload: payload,
    };
    console.log(newPacket);
    that.mqttServer.publish(newPacket);
  },

  command: function(c,value) {

    return;
    this.log(this.name + " sending command " + c);
    var url = this.commands[c];
    if (value != undefined) {
      url = this.commands[c] + "&value="+value
    }

    var that = this;
    request.put({
      url: url
    }, function(err, response) {
      if (err) {
        that.log("There was a problem sending command " + c + " to" + that.name);
        that.log(url);
      } else {
        that.log(that.name + " sent command " + c);
      }
    })
  },

  informationCharacteristics: function() {
    return [
      {
        cType: types.NAME_CTYPE,
        onUpdate: null,
        perms: ["pr"],
        format: "string",
        initialValue: this.name,
        supportEvents: false,
        supportBonjour: false,
        manfDescription: "Name of the accessory",
        designedMaxLength: 255
      },{
        cType: types.MANUFACTURER_CTYPE,
        onUpdate: null,
        perms: ["pr"],
        format: "string",
        initialValue: "SmartThings",
        supportEvents: false,
        supportBonjour: false,
        manfDescription: "Manufacturer",
        designedMaxLength: 255
      },{
        cType: types.MODEL_CTYPE,
        onUpdate: null,
        perms: ["pr"],
        format: "string",
        initialValue: "Rev-1",
        supportEvents: false,
        supportBonjour: false,
        manfDescription: "Model",
        designedMaxLength: 255
      },{
        cType: types.SERIAL_NUMBER_CTYPE,
        onUpdate: null,
        perms: ["pr"],
        format: "string",
        initialValue: "A1S2NASF88EW",
        supportEvents: false,
        supportBonjour: false,
        manfDescription: "SN",
        designedMaxLength: 255
      },{
        cType: types.IDENTIFY_CTYPE,
        onUpdate: null,
        perms: ["pw"],
        format: "bool",
        initialValue: false,
        supportEvents: false,
        supportBonjour: false,
        manfDescription: "Identify Accessory",
        designedMaxLength: 1
      }
    ]
  },

  controlCharacteristics: function(that) {

    cTypes = [{
      cType: types.NAME_CTYPE,
      onUpdate: null,
      perms: ["pr"],
      format: "string",
      initialValue: this.name,
      supportEvents: true,
      supportBonjour: false,
      manfDescription: "Name of service",
      designedMaxLength: 255
    }]

    if (this.sType() == types.GARAGE_DOOR_OPENER_STYPE) {
      cTypes.push({
        cType: types.CURRENT_DOOR_STATE_CTYPE,
        perms: ["pr","ev"],
        format: "int",
        initialValue: 0,
        supportEvents: false,
        supportBonjour: false,
        manfDescription: "BlaBla",
        designedMinValue: 0,
        designedMaxValue: 4,
        designedMinStep: 1,
        designedMaxLength: 1,
        onRegister: function(characteristic) {
          that.currentStateCharacteristic = characteristic;
          characteristic.eventEnabled = true;
        },
        /*
        onRead: function(callback) {
          console.log(">> current read");
          callback(0);
        },
        onUpdate: function(value) { that.log("Update current state to " + value); },
        */
      },{
        cType: types.TARGET_DOORSTATE_CTYPE,
        onRegister: function(characteristic) {
          that.targetStateCharacteristic = characteristic;
          characteristic.eventEnabled = true;
        },
        onRead: function(callback) {
          console.log(">> target read");
          callback(0);
        },
        onUpdate: function(value) {
          console.log("target is", value);
          if (that.initialized) {
            if (value) {
              that.sendMqttCommand(that.mqttId,'closeDoor');
            } else {
              that.sendMqttCommand(that.mqttId,'openDoor');
            };
          } else {
            that.initialized = true;
          }
        },
        perms: ["pr","pw","ev"],
        format: "int",
        initialValue: 0,
        supportEvents: true,
        supportBonjour: false,
        manfDescription: "BlaBla",
        designedMinValue: 0,
        designedMaxValue: 1,
        designedMinStep: 1,
        designedMaxLength: 1
      },{
        cType: types.OBSTRUCTION_DETECTED_CTYPE,
        onUpdate: function(value) { that.log("Obstruction detected: " + value); },
        perms: ["pr","ev"],
        format: "bool",
        initialValue: false,
        supportEvents: false,
        supportBonjour: false,
        manfDescription: "BlaBla"
      });

    } else {

      if (this.commands['on'] != undefined) {
        cTypes.push({
          cType: types.POWER_STATE_CTYPE,
          onUpdate: function(value) {
            if (value == 0) {
              that.commands.off()
            } else {
              that.commands.on()
            }
          },
          perms: ["pw","pr","ev"],
          format: "bool",
          initialValue: this.state.on,
          supportEvents: true,
          supportBonjour: false,
          manfDescription: "Change the power state",
          designedMaxLength: 1
        })
      }

      if (this.commands['on'] != undefined) {
        cTypes.push({
          cType: types.BRIGHTNESS_CTYPE,
          onUpdate: function(value) { that.command("setLevel", value); },
          perms: ["pw","pr","ev"],
          format: "int",
          initialValue:  0,
          supportEvents: true,
          supportBonjour: false,
          manfDescription: "Adjust Brightness of Light",
          designedMinValue: 0,
          designedMaxValue: 100,
          designedMinStep: 1,
          unit: "%"
        })
      }

      if (this.commands['setHue'] != undefined) {
        cTypes.push({
          cType: types.HUE_CTYPE,
          onUpdate: function(value) { that.command("setHue", value); },
          perms: ["pw","pr","ev"],
          format: "int",
          initialValue:  0,
          supportEvents: true,
          supportBonjour: false,
          manfDescription: "Adjust Hue of Light",
          designedMinValue: 0,
          designedMaxValue: 360,
          designedMinStep: 1,
          unit: "arcdegrees"
        })
      }

      if (this.commands['setSaturation'] != undefined) {
        cTypes.push({
          cType: types.SATURATION_CTYPE,
          onUpdate: function(value) { that.command("setSaturation", value); },
          perms: ["pw","pr","ev"],
          format: "int",
          initialValue:  0,
          supportEvents: true,
          supportBonjour: false,
          manfDescription: "Adjust Brightness of Light",
          designedMinValue: 0,
          designedMaxValue: 100,
          designedMinStep: 1,
          unit: "%"
        })
      }
    }

    return cTypes
  },

  sType: function() {
      return types.GARAGE_DOOR_OPENER_STYPE;
    //if (this.commands['setLevel'] != undefined) {
      return types.LIGHTBULB_STYPE
    //} else {
     // return types.SWITCH_STYPE
   // }
  },

  getServices: function() {
    var that = this;
    var services = [{
      sType: types.ACCESSORY_INFORMATION_STYPE,
      characteristics: this.informationCharacteristics(),
    },
    {
      sType: this.sType(),
      characteristics: this.controlCharacteristics(that)
    }];
    this.log("Loaded services for " + this.name)
    return services;
  }
};

module.exports.accessory = MqttAccessory;
module.exports.platform = MqttPlatform;
