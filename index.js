"use strict";

var Service, Characteristic;
var Telnet = require('telnet-client');
var Mutex = require('async-mutex').Mutex;

module.exports = function(homebridge) {

  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory("homebridge-savantaudio", "SavantAudio", SavantAudio);
}

var SavantMutex = new Mutex();

function SavantAudio(log, config) {
  this.log = log;

  this.host = config["host"];
  this.port = config["port"];
  this.name = config["name"];
  this.from = config["from"];
  this.to = config["to"];
  this.fixed = config["fixed"];
  this.timeout = config["timeout"];
  this.state = 'unknown';
  this.conf = 'unknown';
  this.oldconf = 'unknown';
  this.volume = 'unknown';
  this.oldvolume = 'unknown';
  this.mute = 'unknown';
  this.oldmute = 'unknown';
  this.mutestr = 'aoutput-mute' + this.to + ':';
  this.volstr = 'aoutput-vol' + this.to + ':';
}

SavantAudio.prototype = {

  parseResponse: function (response) {
    response = response.trim();
    this.log('[' + this.name + '] Got response: ' + response);
    if (response.startsWith('switch' + this.to + '.' + this.from)) {
      this.state = 'on';
    }
    else if (response.startsWith('switch' + this.to + '.0')) {
      this.state = 'off';
    }
    else if (response.startsWith('aoutput-conf' + this.to + ':processed')) {
      this.oldconf = this.conf;
      this.conf = 'processed';
    }
    else if (response.startsWith('aoutput-conf' + this.to + ':passthru')) {
      this.oldconf = this.conf;
      this.conf = 'passthru';
      this.oldmute = this.mute;
      this.mute = 'off';
      this.oldvolume = this.volume;
      this.volume = '0dB';
    }
    else if (response.startsWith(this.mutestr)) {
      this.oldmute = this.mute;
      this.mute = response.substring(this.mutestr.length);
    }
    else if (response.startsWith(this.volstr)) {
      this.oldvolume = this.volume;
      this.volume = response.substring(this.volstr.length);
    }
  },

  sendCommand: function (connection, command) {
    const me = this;
    return new Promise( (resolve,reject) => {
    me.log('[' + me.name + '] Sending command: ' + command);
    connection.send(command, {timeout: me.timeout, waitfor: '^(switch|aoutput|ainput)'})
	      .then((res) => me.parseResponse(res))
	      .then(resolve)
              .catch(reject);
    });
  },

  getPowerState: function (callback) {
    const me = this;
    SavantMutex.acquire().then(function(release) {
      var connection = new Telnet();
      me.log('connecting to ' + me.host + ":" + me.port);
      connection.connect({ host: me.host, port: me.port, irs: "\r\n", ors: "\r\n", shellPrompt: '', negotiationMandatory: false, timeout: me.timeout })
	.then((prompt) => me.sendCommand(connection,'switch-get' + me.to))
	.then(() => connection.end())
	.then(() => callback(null, me.state == 'on'))
	.then(() => release())
	.catch((error) => { me.log('[' + me.name + '] Got error: ' + error); release(); });
    });
  },

  setPowerState: function (powerOn, callback) {
    const me = this;
    SavantMutex.acquire().then(function(release) {
      var connection = new Telnet();
      me.log('connecting to ' + me.host + ":" + me.port);
      var con = connection.connect({ host: me.host, port: me.port, shellPrompt: '', negotiationMandatory: false, timeout: me.timeout })
      if (powerOn) {
        if (me.fixed) {
	  con = con.then(() => me.sendCommand(connection, 'aoutput-conf-get' + me.to))
		   .then(() => me.sendCommand(connection, 'aoutput-mute-get' + me.to))
		   .then(() => me.sendCommand(connection, 'aoutput-vol-get' + me.to))
	           .then(() => me.sendCommand(connection, 'aoutput-conf-set' + me.to + ':passthru'));
        }
        con = con.then(() => me.sendCommand(connection, 'switch-set' + me.to + '.' + me.from));
      } else {
        con = con.then(() => me.sendCommand(connection, 'switch-set' + me.to + '.disconnect'));
	if (me.fixed && me.oldconf == 'processed') {
	  con = con.then(() => me.sendCommand(connection, 'aoutput-conf-set' + me.to + ':processed'))
		   .then(() => me.sendCommand(connection, 'aoutput-mute-set' + me.to + ':' + me.oldmute))
		   .then(() => me.sendCommand(connection, 'aoutput-vol-set' + me.to + ':' + me.oldvolume));
	}
      }
      con.then(() => connection.end())
         .then(() => callback())
         .then(() => release())
         .catch((error) => { me.log('[' + me.name + '] Got error: ' + error); release(); });
     });
  },

  getServices: function() {
    let informationService = new Service.AccessoryInformation();
    informationService
      .setCharacteristic(Characteristic.Manufacturer, "Savant")
      .setCharacteristic(Characteristic.Model, "SSA-3220")
      .setCharacteristic(Characteristic.SerialNumber, "001AAE020E320000");

    var switchService = new Service.Switch(this.name);
    switchService
      .getCharacteristic(Characteristic.On)
      .on('get', this.getPowerState.bind(this))
      .on('set', this.setPowerState.bind(this));

    return [switchService];
  }
};
