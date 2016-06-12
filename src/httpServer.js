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
    if (route.reg.test(req.url)){
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

register(/.*/, (req, res) => {
  res.writeHead(404);
  res.end('Feature not found');
});

function sendCommand(command, value){
  console.log(`command send: ${command}`);

  var data = {command, value};

  var req = https.request({
    hostname: server.hostname,
    port: server.port,
    path: "/command",
    method: "POST",
    rejectUnauthorized: false,
  }, res => {
    res.on('data', d=>{
      console.log(d.toString("utf-8"));
    });
  });
  req.end(JSON.stringify(data));
}

sendCommand("init", {
  blocksize: 100,
  port: config.port
});
