"use strict";

const https = require('https');
const fs = require('fs');
const crypto = require('crypto');


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
}).listen(8013);



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

