"use strict";

function $(selector){
  return document.querySelector(selector);
}

function sendCommand(command, value){
  return fetch("/command", {method:"POST", body: JSON.stringify({command, value})}).then(reader=>reader.status === 200 ? reader.json():Promise.reject(reader.headers.get("message")));
}

setInterval(()=>sendCommand("getState").then(val=>{
  $("#save-to").textContent = val["save-to"];
  let ul = $("#queue");
  ul.innerHTML = "";
  val["download-queue"].forEach(downloadInfo => {
    let li = $("#template .download-item").cloneNode(true);
    li.querySelector(".name").textContent = downloadInfo.file.name;
    li.querySelector(".progress").textContent = `(${downloadInfo.loadedBlock}/${downloadInfo.blockNum})`;
    li.querySelector("button").addEventListener("click", () => sendCommand("resetDownload", {file: downloadInfo.file}));
    ul.appendChild(li);
  });
  $("#download-state .progress").textContent = val["download-state"] || "not downloading";
}),1000);

//$("#stop").addEventListener("click", () => sendCommand("resetDownload"), false);

function gotoDir(path){
  var ul = $("#dir-list");
  ul.innerHTML = "loading...";
  var $path = $("#path");
  $path.innerHTML = "";
  var basePath = "";
  path.replace(/\/$/g,"").split("/").forEach(seg => {
    let $seg = document.createElement("span");
    $seg.textContent = seg || "root";
    $seg.setAttribute("class", "dir-item");
    basePath += seg + "/";
    $seg.addEventListener("click", (path=>()=>gotoDir(path))(basePath));
    $path.appendChild($seg);
    var $slash = document.createElement("span");
    $slash.textContent="/";
    $path.appendChild($slash);
  });
  sendCommand("remoteCommand", {command:"listDir", value:{path}}).then(val=>{
    ul.innerHTML = "";
    val.forEach(item => {
      if (item.info.file) {
        let li = $("#template .file-item").cloneNode(true);
        li.querySelector(".name").textContent = item.name;
        let strSize, size = item.info.size;
        if (size < 1024){
          strSize = size + "B";
        } else if ((size/=1024)<1024) {
          strSize = size.toFixed(2) + "K";
        } else if ((size/=1024)<1024) {
          strSize = size.toFixed(2) + "M";
        } else if ((size/=1024)<1024) {
          strSize = size.toFixed(2) + "G";
        }

        li.querySelector(".size").textContent = `(${strSize})`;
        li.querySelector("button").addEventListener("click", ()=>{
          sendCommand("startDownload", {file: item, path}).then(()=>null,(e)=>alert(e));
        });
        ul.appendChild(li);
      } else {
        let li = $("#template .dir-item").cloneNode(true);
        li.querySelector("a").textContent = item.name;
        li.querySelector("a").addEventListener("click", ()=>{
          gotoDir(path + item.name+"/");
        });
        ul.appendChild(li);
      }
    });
  });
}

gotoDir("/");
