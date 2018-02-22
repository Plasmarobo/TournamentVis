var config = require('./config');
var express = require('express');
const bodyParser = require('body-parser');

var mqtt = require('mqtt');

var tournaments = {};

var client  = mqtt.connect('mqtt://' + config.mqtt_hostname);

client.on('connect', function () {
  console.log("Connecting to " + config.mqtt_topic);
  client.subscribe(config.mqtt_topic);
  console.log("MQTT Connected");
});

client.on('message', function(topic, message) {
  var payload = JSON.parse(message.toString());
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
  "high_value",
  "low_value",
  "high_hits",
  "low_hits",
  ];

function tournament(score_field, player_field, score_type, game_period_ms) {
  this.score_field = score_field;
  this.player_field = player_field;
  this.score_type = score_type;
  this.game_period = game_period_ms; // In Milliseconds
  this.players = {};
  this.brackets = [];
  this.preseason = true;
  this.preseason_start = new Date().getTime();
  this.season_start = this.preseason_start + game_period_ms;
  this.match_start = this.season_start;
  this.advance_hook = null;
  this.advance_handle = null;
  this.finished = false;
  this.winner = null;
  this.depth = 0;
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
  var score = parseInt(json_payload[this.score_field]);
  if (this.preseason) {
    if (!this.players.hasOwnProperty(player)) {
      console.log("Added " + player + " as player");
      this.players[player] = { score: score, seed: 0 };
    }
  } else {
    this.score(player, score);
  }
}

tournament.prototype.start_season = function() {
  this.season_start = new Date().getTime();
  this.match_start = this.season_start + this.game_period;
  var matches = [];
  var pivot = 0;
  console.log("Sorting Players");

  var pad_len = 2;
  var len = Object.keys(this.players).length;
  while(pad_len < len) pad_len *= 2;
  console.log("Need a pad of " + pad_len);
  for(var i = len; i < pad_len; ++i) {
    this.players["Bye " + i] = { score: -1, seed: 0 };
    console.log("Adding Bye");
  }
  for(var player in this.players) {
    var i = 0;
    var match = {name: player, last_score: 0, score: 0, seed: this.players[player].score};
    if (matches.length == 0) {
      matches.push(match);
      continue;
    }
    while((i < matches.length) && (match.seed > matches[i].seed)) {
      // Iterate until we find a seed larger than ourselves
      ++i;
    }
    if (i >= matches.length)
      matches.push(match);
    else
      matches.splice(i, 0, match);
  }
  console.log("Generating Bracket");
  // Build Bracket
  var bracket = [];
  while(matches.length > 1) {
    bracket.push({a: matches.shift(), b: matches.pop()});
  }
  if (matches.length > 0) {
    bracket.push({a: matches.shift()});
  }
  console.log(bracket);
  this.depth = Math.ceil(Math.log2(Object.keys(bracket).length));
  this.brackets.push(bracket);
  this.advance_hook = function(){
    clearTimeout(this.advance_handle);
    if (this.next_bracket() == false) {
      this.finished = true;
      this.winner = this.brackets[this.brackets.length - 1][0].a;
      clearTimeout(this.advance_handle);
    } else {
      this.match_start = new Date().getTime() + this.game_period;
      this.advance_handle = setTimeout(this.advance_hook.bind(this), this.game_period);
    }
  };
  this.preseason = false;
  console.log("Season started");
  this.advance_handle = setTimeout(this.advance_hook.bind(this), this.game_period);
}

tournament.prototype.reset = function() {
  this.players = {};
  this.brackets = [];
  this.preseason = true;
  this.preseason_start = new Date().getTime();
  this.season_start = this.preseason_start + game_period_ms;
  this.match_start = this.season_start;
  this.advance_hook = null;
  this.advance_handle = null;
  this.finished = false;
  this.winner = null;
}

tournament.prototype.pause = function() {
  clearTimeout(this.advance_handle);
}

tournament.prototype.resume = function() {
  this.advance_handle = setTimeout(this.advance_hook.bind(this), this.game_period);
}

tournament.prototype.score = function(player, score) {
  if (this.finished) return;
  var bracket = this.brackets[this.brackets.length -1];
  for(var i = 0; i < bracket.length; ++i) {
    var match = bracket[i];
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
  console.log("NEXT ROUND");
  for(var i = 0; i < bracket.length; ++i) {
    if (next_bracket[next_bracket.length - 1].hasOwnProperty("a") &&
        next_bracket[next_bracket.length - 1].hasOwnProperty("b")) {
      next_bracket.push({});
    }

    var match = bracket[i];
    console.log("Match:");
    console.log(match);
    var next_match;
    if (!match.hasOwnProperty("b") || (match.a.score > match.b.score)) {
      console.log("A wins");
       next_match = {name: match.a.name,
                     last_score: match.a.score,
                     score: 0,
                     seed: match.a.seed};
    } else if (match.b.score > match.a.score) {
      console.log("B wins");
      next_match = {name: match.b.name,
                    last_score: match.b.score,
                    score: 0,
                    seed: match.b.seed};
    } else {
      if (match.a.seed > match.b.seed) {
        console.log("A wins by default");
        next_match = {name: match.a.name,
                      last_score: match.a.score,
                      score: 0,
                      seed: match.a.seed};
      } else {
        console.log("B wins by default");
        next_match = {name: match.b.name,
                      last_score: match.b.score,
                      score: 0,
                      seed: match.b.seed};
      }
    }

    if (next_bracket[next_bracket.length - 1].hasOwnProperty("a")) {
      next_bracket[next_bracket.length - 1].b = next_match;
      console.log(next_bracket);
    } else {
      next_bracket[next_bracket.length - 1].a = next_match;
      console.log(next_bracket);
      if (bracket.length <= 1) {
        this.brackets.push(next_bracket);
        return false;
      }
    }
  }
  this.brackets.push(next_bracket);
}

function start_tournament(name, score_field, player_field, score_type, game_period = 86400000) {
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
  var t = new tournament(score_field, player_field, score_type, game_period);

  if (tournaments.hasOwnProperty(name)) {
    clearInterval(tournaments[name].advance_handle);
  }
  tournaments[name] = t;
  tournaments[name].advance_handle = setTimeout(function() { tournaments[name].start_season(); }, game_period);
  return true;
}

var app = express();

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true}));

app.listen(config.listen_port, function() {
  console.log('Listening on port ' + config.listen_port);
});

app.get('/', function(req, res) {
  res.render('index');
});

app.post('/', function (req, res) {
  var time_parts = req.body.tournament_period.split(":");
  var game_period_ms = 86400000 * parseInt(time_parts[0]);
  game_period_ms += 3600000 * parseInt(time_parts[1]);
  game_period_ms += 60000 * parseInt(time_parts[2]);
  if (start_tournament(req.body.tournament_name,
    req.body.tournament_score,
    req.body.tournament_player,
    req.body.tournament_score_type,
    game_period_ms)) {
    res.redirect('/' + req.body.tournament_name);
  } else {
    res.status(404);
    res.render("404");
  }
});

app.get('/:tournament_name', function(req, res, next){
  var page = req.params["tournament_name"];
  if (tournaments.hasOwnProperty(page)) {
    res.render('view', {tourney: tournaments[page], name: page});
  } else {
    res.status(404);
    res.render("404");
  }
});

app.post('/:tournament_name/start', function(req, res, next){
  var page = req.params["tournament_name"];
  if (tournaments.hasOwnProperty(page)) {
    console.log("Starting " + page);
    clearTimeout(tournaments[page].advance_handle);
    tournaments[page].start_season();
    res.redirect('/' + page);
  } else {
    res.status(404);
    res.redirect("404");
  }
});

var endless_handle = null;

app.get('/endless', function(req, res, next) {
  console.log("Starting Endless");
  if (endless_handle != null) clearInterval(endless_handle);
  console.log(req.query.score_field);
  console.log(req.query.player_field);
  console.log(req.query.score_type);
  console.log(req.query.period_ms);
  var period_ms = req.query.period_ms;
  if (start_tournament("Endless",
        req.query.score_field,
        req.query.player_field,
        req.query.score_type,
        period_ms)) {
    res.render('view', {tourney: tournaments["Endless"], name: "Endless"});
    endless_handle = setInterval(function() {
      if (tournaments["Endless"].finished == false) return;
      setInterval(function(){tournaments["Endless"].reset();},period_ms);
    }, period_ms);
  } else {
    res.status(400);
    res.redirect("404");
  }
});
