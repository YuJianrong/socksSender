"use strict";

const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const server = {
  hostname: "127.0.0.1",
  port: 8085
};

const config = {
  port: 8013
};

console.log("start server");

let routes = [];
function register( reg, cb ) {
  routes.push({reg, cb});
}

https.createServer( {
  key: fs.readFileSync('./certificate/key.pem', 'utf-8'),
  cert: fs.readFileSync('./certificate/cert.pem', 'utf-8')
} , (req, res) => {
  routes.some(route => {
    if (route.reg === req.url || typeof route.reg === "object" && route.reg.test(req.url)){
      route.cb(req, res);
      return true;
    }
    return false;
  });
}).listen(config.port);



register(/^\/$/, (req, res) => {
  res.writeHead(200);
  res.end('hello world\n');
});

register(/\/saveData$/, (req, res) => {
  var chunks = [];
  const hash = crypto.createHash("md5");
  req.on('data', chunk=>{
    hash.update(chunk);
    chunks.push(chunk);
  });
  req.on("end", ()=>{
    let data = Buffer.concat(chunks);
    if (hash.digest("hex") !== req.headers.md5) {
      res.writeHead(500);
      res.end('md5-check-error');
      return;
    } else {
      fs.writeFileSync(decodeURI(req.headers.file) + "." + req.headers.blocknum, data);
      res.writeHead(200);
      res.end('block-saved');
    }
  });
});

register("/index", (req, res) =>{
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end(fs.readFileSync("./page/server.html"));
});

register("/script", (req, res) =>{
  res.writeHead(200, {'Content-Type': 'application/javascript'});
  res.end(fs.readFileSync("./page/script.js"));
});

function sendCommand(command, value){
  console.log(`command send: ${command}`);

  var commandData = {command, value};

  return new Promise((resolve, reject) => {
    var req = https.request({
      hostname: server.hostname,
      port: server.port,
      path: "/command",
      method: "POST",
      rejectUnauthorized: false,
    }, res => {
      var chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
      res.on('error', e => reject(e));
    });
    req.end(JSON.stringify(commandData));
  });
}

const commandHandler = {
  getState: (val , resolve) => resolve({ "save-to" : "~/Desktop/", "download-state": "no"}),
  remoteCommand: (val, resolve) => sendCommand(val.command, val.value).then(resData=>resolve(resData))
};

register("/command", (req, res)=>{
  var chunks = [];
  req.on('data', chunk=> chunks.push(chunk));
  req.on("end", ()=>{
    let data = JSON.parse(Buffer.concat(chunks).toString());
    if (data.command !== "getState") {
      console.log(`local command: ${data.command}`);
    }
    res.writeHead(200);
    (new Promise((resolve, reject)=>commandHandler[data.command].call(null, data.value, resolve)))
    .then(resData=>res.end(JSON.stringify(resData||"success")));
  });
});

register(/.*/, (req, res) => {
  res.writeHead(404);
  res.end('Feature not found');
});



sendCommand("init", {
  blocksize: 100,
  port: config.port
}).then(state=>{
  if (state === "success"){
    require("open")(`https://localhost:${config.port}/index`);
  }
});
