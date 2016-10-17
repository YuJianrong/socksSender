"use strict";

const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const path = require("path");

const receiverConfig = JSON.parse(fs.readFileSync("receiverConfig.json", "utf8"));
if (!receiverConfig.blocksize) {
  receiverConfig.blocksize = 1024*1024;
}

let concurrentDownload = receiverConfig.concurrent || 3;


function log(msg) {
  console.log(`${(new Date()).toISOString()} ${msg}`)
}

log("start receiver");

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
}).listen(receiverConfig.port);


register(/^\/$/, (req, res) => {
  res.writeHead(200);
  res.end('hello world\n');
});


register("/index", (req, res) =>{
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end(fs.readFileSync("./page/receiver.html"));
});

register("/script", (req, res) =>{
  res.writeHead(200, {'Content-Type': 'application/javascript'});
  res.end(fs.readFileSync("./page/script.js"));
});

function sendCommand(command, value, extraMsg){
  log(`command send: ${command} ${extraMsg || "" }`);

  var commandData = {command, value};

  return new Promise((resolve, reject) => {
    var req = https.request({
      hostname: receiverConfig.sender.hostname,
      port: receiverConfig.sender.port,
      path: "/command",
      method: "POST",
      rejectUnauthorized: false,
      timeout: 2*60*1000
    }, res => {
      var chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
      res.on('error', e => reject({code: res.statusCode, err: e}));
    });
    req.on("error", (e) => {
      log(`Error: ${e.message}`);
      reject({code: 0, err: e});
    });
    req.end(JSON.stringify(commandData));
  });
}

var downloadInfos = [];
function saveDownloading(){
  fs.writeFileSync("downloading.json", JSON.stringify(downloadInfos.map(downloadInfo => ({file: downloadInfo.file, path: downloadInfo.path}))));
}
function loadDownloading(){
  try {
    let downloads = JSON.parse(fs.readFileSync("downloading.json", "utf-8"));
    downloads.forEach(val => initDownload(val));
  } catch(e){

  }
}

function resetDownload(filename) {
  let downloadInfo = null, index = -1;
  for (let i = 0; i < downloadInfos.length; ++i) {
    if (downloadInfos[i].file.name === filename) {
      downloadInfo = downloadInfos[i];
      index = i;
      break;
    }
  }
  if (!downloadInfo) {
    return;
  }
  for (let i = 0; i < downloadInfo.blockNum; ++i) {
    try {
      fs.unlinkSync(`${downloadInfo.file.name}.${i}`);
    } catch (e) { }
  }
  downloadInfos.splice(index, 1);
  saveDownloading();
  checkQueue();
}

const commandHandler = {
  getState: (val , resolve) => resolve({
    "save-to" : receiverConfig["save-to"],
    "download-queue": downloadInfos.map(downloadInfo => ({file: downloadInfo.file, loadedBlock: downloadInfo.loadedBlock, blockNum: downloadInfo.blockNum}))
  }),
  remoteCommand: (val, resolve, reject) => sendCommand(val.command, val.value).then(resData=>resolve(resData), e => reject(e.err.message)),
  startDownload: (val, resolve, reject) => {
    if (downloadInfos.some(downloadInfo => downloadInfo.file.name === val.file.name)) {
      reject("File is already in download queue!");
    } else {
      initDownload(val);
      resolve("success");
    }
  },
  resetDownload: (val, resolve) => {
    resetDownload(val.file.name);
    resolve("success");
  }
};

function initDownload(val){
  let blockNum= Math.ceil(val.file.info.size / receiverConfig.blocksize);
  let downloadInfo = {
    file: val.file,
    path: val.path,
    blockNum,
    loadedBlock: 0,
    blocks: Array(blockNum)
  };
  for(let blockid=0; blockid<downloadInfo.blockNum; ++blockid) {
    const blockName = downloadInfo.file.name + "." + blockid;
    const size = blockid === downloadInfo.blockNum - 1 ? downloadInfo.file.info.size % receiverConfig.blocksize : receiverConfig.blocksize;
    if (fs.existsSync(blockName) && fs.statSync(blockName).size === size) {
      downloadInfo.blocks[blockid] = "downloaded";
      downloadInfo.loadedBlock ++;
    } else {
      downloadInfo.blocks[blockid] = "not-downloaded";
    }
  }
  downloadInfos.push(downloadInfo);
  checkQueue();
  saveDownloading();
}

function checkQueue() {
  let downloading = downloadInfos.reduce((sum, downloadInfo) => sum + downloadInfo.blocks.filter(status => status === "downloading").length, 0);
  if (downloading >= concurrentDownload) {
    return;
  }
  for (let i = 0; i < downloadInfos.length; ++i) {
    let downloadInfo = downloadInfos[i];
    for (let blockid = 0; blockid < downloadInfo.blockNum; ++blockid) {
      if (downloadInfo.blocks[blockid] === "not-downloaded") {
        downloading++;
        downloadInfo.blocks[blockid] = "downloading";
        sendCommand("getBlock", { file: downloadInfo.file, path: downloadInfo.path, blockid }, `${downloadInfo.file.name} : [${blockid}]`)
        .catch(e => {
          if (e.code === 500) {
            log(`Error: ${e.err.message}, download aborted!`);
          } else {
            log(`Error: ${e.err.message}, Retry in 60s`);
            downloadInfo.blocks[blockid] = "not-downloaded";
            // retry in 60 s
            setTimeout(checkQueue, 60 * 1000);
          }
        });
        setTimeout(checkQueue, 0);
        return;
      }
    }
  }
}

register("/saveData", (req, res) => {
  var chunks = [];
  const hash = crypto.createHash("md5");
  req.on('data', chunk=>{
    hash.update(chunk);
    chunks.push(chunk);
  });
  req.on("end", ()=>{
    let data = Buffer.concat(chunks);
    if (hash.digest("hex") !== req.headers.md5) {
      res.writeHead(500, {state: 'md5-check-error'});
      res.end();
      return;
    } else {
      let downloadInfo = downloadInfos.find(downloadInfo => downloadInfo.file.name === decodeURI(req.headers.file));
      if (!downloadInfo) {
        // the download may had been reset, so response 200 to stop resend the block
        res.writeHead(200, {state: 'wrong-file'});
        res.end();
      } else {
        fs.writeFileSync(decodeURI(req.headers.file) + "." + req.headers.blockid, data);
        downloadInfo.loadedBlock ++;
        downloadInfo.blocks[req.headers.blockid] = "downloaded";
        if (downloadInfo.loadedBlock === downloadInfo.blockNum) {
          log("download Finished, start data merge");
          let target = path.parse(path.join(receiverConfig["save-to"].replace("~", process.env.HOME), decodeURI(req.headers.file)));
          let suffix = 0;
          while(1){
            const targetPath = path.join(target.dir, target.name + ( suffix ? ` (${suffix})` : "" ) + target.ext);
            try{
              const fd = fs.openSync(targetPath, "ax");
              for(var i=0; i<downloadInfo.blockNum; ++i) {
                const buf = fs.readFileSync(decodeURI(req.headers.file) + "." + i);
                fs.writeSync(fd, buf, 0, buf.length);
              }
              fs.closeSync(fd);
              log("done");
              break;
            } catch(e){
              if (e.code === "EEXIST") {
                suffix ++;
              } else {
                log(`Error: ${e.message}`);
                break;
              }
            }
          }
          resetDownload(downloadInfo.file.name);
        } else {
          //setTimeout(checkQueue, 10*1000);
          checkQueue();
        }
        res.writeHead(200, {state: 'block-saved'});
        res.end();
      }
    }
  });
  req.on("error", e => {
    res.writeHead(500, {state:"error"});
    res.end(e.message);
  });
});

register("/command", (req, res)=>{
  var chunks = [];
  req.on('data', chunk=> chunks.push(chunk));
  req.on("end", ()=>{
    let data = JSON.parse(Buffer.concat(chunks).toString());
    if (data.command !== "getState") {
      log(`local command: ${data.command}`);
    }
    (new Promise((resolve, reject)=>commandHandler[data.command].call(null, data.value, resolve, reject)))
    .then(resData=>{
      res.writeHead(200);
      res.end(JSON.stringify(resData||"success"));
    }, e=>{
      res.writeHead(500, {message:e});
      res.end(JSON.stringify("error"));
    });
  });
});

register(/.*/, (req, res) => {
  res.writeHead(404);
  res.end('Feature not found');
});



sendCommand("init", {
  blocksize: receiverConfig.blocksize,
  port: receiverConfig.port
}).then(state=>{
  if (state === "success"){
    require("open")(`https://localhost:${receiverConfig.port}/index`);
    loadDownloading();
  }
});
