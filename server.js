
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_KEY = process.env.ADMIN_KEY || "123456";
const MONGODB_URI = process.env.MONGODB_URI || "";
const IPTV_ORG_URL = process.env.IPTV_ORG_URL || "";
const AUTO_SYNC_HOURS = Math.max(1, Number(process.env.AUTO_SYNC_HOURS || 24));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
app.use(express.json({limit:"3mb"}));
app.use(express.static("public"));

let db = null, channels = null, settings = null;
let mem = [];
let syncState = { lastSyncAt:null, lastImported:0, lastError:null, running:false };

function auth(req,res,next){
  const key = req.headers["x-admin-key"] || req.query.key;
  if(key !== ADMIN_KEY) return res.status(401).json({ok:false,error:"Sai mật khẩu admin"});
  next();
}
function normalizeUrl(u){ return String(u||"").trim(); }
function parseM3U(text, source="manual"){
  const lines = String(text||"").replace(/\r/g,"").split("\n");
  const out=[];
  for(let i=0;i<lines.length;i++){
    const meta=lines[i].trim();
    if(!meta.startsWith("#EXTINF:")) continue;
    let j=i+1;
    while(j<lines.length && (!lines[j].trim() || lines[j].trim().startsWith("#"))) j++;
    if(j>=lines.length) continue;
    const url=normalizeUrl(lines[j]);
    if(!/^https?:\/\//i.test(url)) continue;

    const name=(meta.split(",").slice(1).join(",").trim() || "Kênh");
    const logo=(meta.match(/tvg-logo="([^"]*)"/i)||[])[1] || "";
    const group=(meta.match(/group-title="([^"]*)"/i)||[])[1] || "Khác";
    const tvgId=(meta.match(/tvg-id="([^"]*)"/i)||[])[1] || "";
    const tvgName=(meta.match(/tvg-name="([^"]*)"/i)||[])[1] || "";
    out.push({
      name, logo, group, tvgId, tvgName, url,
      source, enabled:true, updatedAt:new Date()
    });
  }
  return out;
}
async function initDb(){
  if(!MONGODB_URI){
    console.log("[MongoDB] MONGODB_URI not set - memory mode");
    return;
  }
  try{
    const client=new MongoClient(MONGODB_URI);
    await client.connect();
    db=client.db();
    channels=db.collection("iptv_channels");
    settings=db.collection("iptv_settings");
    await channels.createIndex({source:1,url:1},{unique:true});
    await channels.createIndex({name:1});
    console.log("[MongoDB] connected:", db.databaseName);
  }catch(e){
    console.error("[MongoDB]", e.message);
  }
}
async function fetchText(url){
  const r=await fetch(url,{headers:{"user-agent":"IPTV-Personal-Render/2.0"}});
  if(!r.ok) throw new Error(`HTTP ${r.status} khi tải playlist`);
  return await r.text();
}
async function syncIptvOrg(){
  if(syncState.running) return syncState;
  syncState.running=true;
  syncState.lastError=null;
  try{
    const text=await fetchText(IPTV_ORG_URL);
    const docs=parseM3U(text,"iptv-org");
    if(!docs.length) throw new Error("Playlist IPTV-org không có kênh hợp lệ");

    if(channels){
      const ops=docs.map(d=>({
        updateOne:{
          filter:{source:"iptv-org",url:d.url},
          update:{$set:d,$setOnInsert:{createdAt:new Date()}},
          upsert:true
        }
      }));
      if(ops.length) await channels.bulkWrite(ops,{ordered:false});
    }else{
      const existing=new Map(mem.filter(x=>x.source==="iptv-org").map(x=>[x.url,x]));
      for(const d of docs){
        const old=existing.get(d.url);
        if(old) Object.assign(old,d);
        else mem.push({...d,_id:String(Date.now())+Math.random()});
      }
    }
    syncState.lastSyncAt=new Date().toISOString();
    syncState.lastImported=docs.length;
    if(settings){
      await settings.updateOne({_id:"iptv-org-sync"},{$set:{...syncState,url:IPTV_ORG_URL}},{upsert:true});
    }
    console.log("[IPTV-org] synced", docs.length, "channels");
  }catch(e){
    syncState.lastError=e.message;
    console.error("[IPTV-org]",e.message);
  }finally{
    syncState.running=false;
  }
  return syncState;
}

app.get("/api/channels", async(req,res)=>{
  const list=channels
    ? await channels.find({enabled:{$ne:false}}).sort({order:1,group:1,name:1}).toArray()
    : mem.filter(x=>x.enabled!==false).sort((a,b)=>(a.order??999999)-(b.order??999999));
  res.json({ok:true,channels:list});
});
app.get("/api/admin/channels",auth,async(req,res)=>{
  const list=channels?await channels.find({}).sort({order:1,group:1,name:1}).toArray():mem.slice().sort((a,b)=>(a.order??999999)-(b.order??999999));
  res.json({ok:true,channels:list,syncState,iptvOrgUrl:IPTV_ORG_URL});
});
app.post("/api/admin/channels",auth,async(req,res)=>{
  const {name,url,logo="",group="Khác",enabled=true}=req.body;
  if(!name||!url) return res.status(400).json({ok:false,error:"Thiếu tên hoặc URL"});
  const doc={name,url:normalizeUrl(url),logo,group,source:"manual",enabled:enabled!==false,createdAt:new Date(),updatedAt:new Date()};
  if(channels){const r=await channels.insertOne(doc);doc._id=r.insertedId;}
  else {doc._id=String(Date.now());mem.push(doc);}
  res.json({ok:true,channel:doc});
});
app.put("/api/admin/channels/:id",auth,async(req,res)=>{
  const patch={updatedAt:new Date()};
  for(const k of ["name","url","logo","group","enabled"]) if(req.body[k]!==undefined) patch[k]=req.body[k];
  if(channels) await channels.updateOne({_id:new ObjectId(req.params.id)},{$set:patch});
  else{const x=mem.find(x=>String(x._id)===req.params.id);if(x)Object.assign(x,patch);}
  res.json({ok:true});
});

app.post("/api/admin/reorder",auth,async(req,res)=>{
  const ids=Array.isArray(req.body.ids)?req.body.ids:[];
  if(!ids.length) return res.status(400).json({ok:false,error:"Thiếu danh sách thứ tự"});
  if(channels){
    const ops=ids.map((id,i)=>({updateOne:{filter:{_id:new ObjectId(id)},update:{$set:{order:i,updatedAt:new Date()}}}}));
    await channels.bulkWrite(ops,{ordered:false});
  }else{
    ids.forEach((id,i)=>{const x=mem.find(a=>String(a._id)===String(id));if(x)x.order=i});
  }
  res.json({ok:true});
});

app.delete("/api/admin/channels/:id",auth,async(req,res)=>{
  if(channels) await channels.deleteOne({_id:new ObjectId(req.params.id)});
  else mem=mem.filter(x=>String(x._id)!==req.params.id);
  res.json({ok:true});
});
app.post("/api/admin/import-m3u",auth,upload.single("file"),async(req,res)=>{
  const text=req.file?req.file.buffer.toString("utf8"):(req.body.text||"");
  const docs=parseM3U(text,"manual");
  if(!docs.length) return res.status(400).json({ok:false,error:"Không tìm thấy kênh hợp lệ"});
  if(channels){
    for(const d of docs){
      await channels.updateOne({source:"manual",url:d.url},{$set:d,$setOnInsert:{createdAt:new Date()}},{upsert:true});
    }
  }else{
    for(const d of docs) if(!mem.some(x=>x.source==="manual"&&x.url===d.url)) mem.push({...d,_id:String(Date.now())+Math.random()});
  }
  res.json({ok:true,imported:docs.length});
});
app.post("/api/admin/sync-iptv-org",auth,async(req,res)=>{
  const state=await syncIptvOrg();
  res.status(state.lastError?500:200).json({ok:!state.lastError,...state});
});
app.get("/api/admin/sync-status",auth,(req,res)=>res.json({ok:true,...syncState,url:IPTV_ORG_URL}));
app.get("/health",(req,res)=>res.json({ok:true,mongo:!!channels,database:db?.databaseName||null,iptvOrg:syncState}));

app.get("/admin",(req,res)=>res.sendFile(__dirname+"/public/admin.html"));

initDb().then(async()=>{
  app.listen(PORT,"0.0.0.0",()=>console.log("Server listen on port",PORT));
  setTimeout(syncIptvOrg, 5000);
  setInterval(syncIptvOrg, AUTO_SYNC_HOURS*60*60*1000);
});
