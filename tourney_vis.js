var config = require('./config');
var mqtt = require('mqtt');

var tournaments = {};

var client = mqtt.connect(config.mqtt_host);

client.on('connect', function() {
  client.subscribe(config.mqtt_topic);
});

client.on('message', function(topic, message) {
  var payload = JSON.parse(message);
  for(var tournament in tournaments) {
    tournaments[tournament].process_record(payload);
  }
});

//A tourney may be created for any field that has value
var score_fields = [
  "spend_amount",
  "ready_time",
  "earn_amount",
  "tip_amount",
  "created_at",
  ];

//A player may be added from any field that has metadata
var player_fields = [
  "merchant_name",
  "location_name",
  "app_name",
  "app_id",
  "postal_code"
  ];

var score_types = [
  "high value",
  "low value",
  "high hits",
  "low hits",
  ];

function tournament(score_field, player_field, score_type, game_period_ms) {
  this.score_field = score_field;
  this.player_field = player_field;
  this.score_type = score_type;
  this.players = {};
  this.brackets = [];
  this.preseason = true;
  this.preseason_start = new Date().getTime();
  this.season_start = null;
  this.game_period = game_period_ms; // In Milliseconds
  this.advance_hook = null;
  this.advance_handle = null;
  this.finished = false;
}

tournament.prototype.save = function(filename) {
  require('fs').writeFile(filename, JSON.stringify(this));
}

tournament.prototype.load = function(filename) {
  require('fs').readFile(filename, function(err, data) {
    Object.assign(this,JSON.parse(data));
  }.bind(this));
}

tournament.prototype.process_record = function(json_payload) {
  var player = json_payload[this.player_field];
  var score = json_payload[this.score_field];
  if (this.preseason) {
    if (!this.players.hasOwnProperty(player)) {
      this.players[player] = { score: 0, seed: 0 };
      this.players[player].score += score;
    }
  } else {
    this.score(player, score);
  }
}

tournament.prototype.scores_to_seed = function() {
  for(var player in this.players) {
    this.palyers[player].seed = this.players[player].score;
    this.players[player].score = 0;
  }
}

tournament.prototype.start_season = function() {
  this.season_start = new Date().getTime();
  this.preseason = false;
  var matches = [];
  var pivot = 0;

  for(var player in this.players) {
    var i = 0;
    while(i < matches.length) {
      // Iterate until we find a seed larger than ourselves
      if (this.players[player].seed > this.matches[i].seed)
        ++i;
    }
    var match = {name: player, score: 0, seed: this.players[player].seed};
    if (i >= matches.length)
      matches.push(match);
    else
      matches.splice(i, 0, match);
  }
  // Build Bracket
  var bracket = [];
  while(matches.length > 1) {
    bracket.push({a: matches.shift(), b: matches.pop()});
  }
  if (matche.length > 0) {
    bracket.push({a: matches.shift()});
  }
  this.brackets.push(bracket);
  this.advance_hook = function(){
    this.next_bracket();
    if (this.brackets[this.brackets.length - 1].length == 1)
      this.finished = true;
    else
      this.advance_handle = setTimeout(this.advance_hook.bind(this), this.game_period);
  };
  this.advance_handle = setTimeout(this.advance_hook.bind(this), this.game_period);
}

tournament.prototype.pause = function() {
  clearTimeout(this.advance_handle);
}

tournament.prototype.resume = function() {
  this.advance_handle = setTimeout(this.advance_hook.bind(this), this.game_period);
}

tournament.prototype.score = function(player, score) {
  var bracket = this.brackets[this.brackets.length -1];
  for(var match in bracket) {
    if (match.a.name == player) {
      match.a.score += score;
      break;
    } else if (match.hasOwnProperty("b") && (match.b.name == player)) {
      match.b.score += score;
      break;
    }
  }
}

tournament.prototype.next_bracket = function() {
  var bracket = this.brackets[this.brackets.length - 1];
  var next_bracket = [{}];

  for(var match in brackets) {
    var next_match;
    if (!match.hasOwnProperty("b") || (match.a.score > match.b.score)) {
       next_match = {name: match.a.name, score: 0, seed: match.a.seed};
    } else if (match.b.score > match.a.score) {
      next_match = {name: match.b.name, score: 0, seed: match.b.seed};
    } else {
      if (match.a.seed > match.b.seed) {
        next_match = {name: match.a.name, score: 0, seed: match.a.seed};
      } else {
        next_match = {name: match.b.name, score: 0, seed: match.b.seed};
      }
    }
    if (next_bracket[next_bracket.length - 1].hasOwnProperty("a")) {
      next_bracket[next_bracket.length - 1].b = next_match;
      next_bracket.push({});
    } else {
      next_bracket[next_bracket.length - 1].a = next_match;
    }
  }
  this.brackets.push(next_bracket);
}

function start_tournament(name, score_field, player_field, score_type) {
  if (! (score_fields.includes(score_field))) {
    console.log("Bad score_field " + score_field);
    return false;
  }
  if (! (player_fields.includes(player_field))) {
    console.log("Bad player_field " + player_field);
    return false;
  }
  if (! (score_types.includes(score_type))) {
    console.log("Bad score_type " + score_type);
    return false;
  }
  var t = tournament(score_field, player_field, score_type, 86400000);
  if (tournaments.hasOwnProperty(name)) {
    tournaments[name].stop();
  }
  tournaments[name] = t;
  return true;
}

module.exports = {start_tournament, tournaments};
