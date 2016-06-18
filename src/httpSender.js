"use strict";

const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const path = require("path");
const shttps = require('socks5-https-client');

const serverConfig = {
};

const config = JSON.parse(fs.readFileSync("senderConfig.json"));

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

var downloadInfo = null;

const commandHandler = {
  init: (val, req) => {
    serverConfig.blocksize = val.blocksize;
    serverConfig.hostname = req.connection.remoteAddress.replace(/.*:/,"");
    serverConfig.port = val.port;
    console.dir(serverConfig);
    return "success";
  },
  listDir: val => {
    if (process.platform === 'win32') {
      if (val.path === "/") {
        let drivers = [];
        for (var c=67; c<=90; ++c) {
          try{
            fs.readdirSync(String.fromCharCode(c) + ":/");
            drivers.push({name: String.fromCharCode(c) + ":" , info:{size:0, file: false}});
          }catch(e){};
        }
        return drivers;
      } else {
        val.path = val.path.substr(1);
      }
    }
    const files = fs.readdirSync(val.path);
    const dir = [];
    for (let i=0; i<files.length; ++i) {
      try{
        dir.push({name:files[i],info: (stat=>({size:stat.size,file:stat.isFile()}))(fs.statSync(path.join(val.path, files[i])))});
      } catch(e){
      }
    }
    return dir;
  },
  startDownload: val=>{
    downloadInfo = {
      file: val.file,
      path: process.platform === 'win32' ? val.path.substr(1):val.path,
    };
    prepareFile();
    checkQueue();
    return "success";
  },
  reset: val=>{
    if (!downloadInfo) {
      return "success";
    }
    fs.closeSync(downloadInfo.fd);
    downloadInfo = null;
    return "success";
  }
};

register(/^\/command$/, (req, res) => {

  var chunks = [];
  req.on('data', chunk=>{
    chunks.push(chunk);
  });
  req.on("end", ()=>{
    let data = JSON.parse(Buffer.concat(chunks).toString());
    console.log(`run command: ${data.command}`);
    res.writeHead(200);
    res.end(JSON.stringify(commandHandler[data.command].call(null, data.value, req) || "success"));
  });
});

register(/.*/, (req, res) => {
  res.writeHead(404);
  res.end('Feature not found');
});


function prepareFile(){
  const filePath = path.join(downloadInfo.path, downloadInfo.file.name);
  downloadInfo.fd = fs.openSync(filePath, "r");
  downloadInfo.blocks = [];
  downloadInfo.blockNum = Math.ceil(downloadInfo.file.info.size / serverConfig.blocksize);
  for(var i=0; i< downloadInfo.blockNum; ++i) {
    downloadInfo.blocks.push("not-uploaded");
  };
}

function updateBlock(fd, blockid, status){
  if (!downloadInfo || downloadInfo.fd !== fd) {
    return;
  }
  downloadInfo.blocks[blockid] = status;
  checkQueue();
}

function checkQueue(){
  const concurrentUpload = 3;
  let currentUpload = downloadInfo.blocks.filter(status => status === "uploading").length;
  let uploadedNum = 0;
  for( var i=0; i<downloadInfo.blockNum; ++i){
    if (currentUpload < concurrentUpload && downloadInfo.blocks[i] === "not-uploaded") {
      currentUpload ++;
      sendFilePart(i);
    }
    uploadedNum += downloadInfo.blocks[i] === "uploaded" ? 1 : 0;
  }
  if (uploadedNum === downloadInfo.blockNum) {
    commandHandler.reset();
  }
}

function sendFilePart(blockid){
  const size = blockid === downloadInfo.blockNum - 1 ? downloadInfo.file.info.size % serverConfig.blocksize : serverConfig.blocksize;
  const buf = new Buffer(size);
  downloadInfo.blocks[blockid] = "uploading";

  const fd = downloadInfo.fd;

  (new Promise((resolve,reject) => fs.read(
    downloadInfo.fd,
    buf,
    0,
    size,
    blockid * serverConfig.blocksize,
    (err, byteRead, buffer) => {
      if (err){
        reject(err);
      } else {
        resolve(buffer);
      }
    }
  ))).then(buf => {
    const hash = crypto.createHash("md5");
    hash.update(buf);

    if(!downloadInfo || fd !== downloadInfo.fd){
      return;
    }

    var req = (config.socks5 ? shttps : https).request({
      hostname: serverConfig.hostname,
      port: serverConfig.port,
      path: "/saveData",
      method: "POST",
      rejectUnauthorized: false,
      headers: {
        file: encodeURI( path.basename(downloadInfo.file.name) ),
        md5: hash.digest("hex"),
        blockid: blockid
      },
      socksHost: config.socks5 ? config.socks5.host: null,
      socksPort: config.socks5 ? config.socks5.port: null,
    }, res => {
      if (res.statusCode === 200) {
        updateBlock(fd, blockid, "uploaded");
      } else {
        updateBlock(fd, blockid, "not-uploaded");
      }
    });
    req.on("error", (e)=>{
      console.log(`problem on send block[${blockid}]: ${e.message}`);
      updateBlock(fd, blockid, "not-uploaded");
    });

    req.write(buf);
    req.end();
  }).catch(e => {
    console.error(e);
  });
}

