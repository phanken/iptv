const express=require("express"),{MongoClient,ObjectId}=require("mongodb"),multer=require("multer");
const app=express(),PORT=process.env.PORT||10000,KEY=process.env.ADMIN_KEY||"123456",URI=process.env.MONGODB_URI||"",up=multer({storage:multer.memoryStorage()});
app.use(express.json());app.use(express.static("public"));let col,mem=[];
(async()=>{if(URI)try{let c=new MongoClient(URI);await c.connect();let db=c.db();col=db.collection("iptv_channels");console.log("[MongoDB]",db.databaseName)}catch(e){console.log("[MongoDB]",e.message)}app.listen(PORT,"0.0.0.0",()=>console.log("Server listen on port",PORT))})();
const auth=(q,s,n)=>(q.headers["x-admin-key"]===KEY?n():s.status(401).json({error:"Sai mật khẩu admin"}));
app.get("/api/channels",async(q,s)=>s.json({channels:col?await col.find({enabled:{$ne:false}}).toArray():mem.filter(x=>x.enabled!==false)}));
app.get("/api/admin/channels",auth,async(q,s)=>s.json({channels:col?await col.find({}).toArray():mem}));
app.post("/api/admin/channels",auth,async(q,s)=>{let d={name:q.body.name,url:q.body.url,logo:q.body.logo||"",group:q.body.group||"Khác",enabled:true};if(!d.name||!d.url)return s.status(400).json({error:"Thiếu tên hoặc URL"});if(col){let r=await col.insertOne(d);d._id=r.insertedId}else{d._id=String(Date.now());mem.push(d)}s.json({ok:true})});
app.put("/api/admin/channels/:id",auth,async(q,s)=>{if(col)await col.updateOne({_id:new ObjectId(q.params.id)},{$set:{enabled:q.body.enabled}});else{let x=mem.find(a=>String(a._id)===q.params.id);if(x)x.enabled=q.body.enabled}s.json({ok:true})});
app.delete("/api/admin/channels/:id",auth,async(q,s)=>{if(col)await col.deleteOne({_id:new ObjectId(q.params.id)});else mem=mem.filter(a=>String(a._id)!==q.params.id);s.json({ok:true})});
function parse(t){let a=t.replace(/\r/g,"").split("\n"),o=[];for(let i=0;i<a.length;i++)if(a[i].startsWith("#EXTINF:")){let m=a[i],u=(a[i+1]||"").trim();if(/^https?:\/\//.test(u))o.push({name:m.split(",").slice(1).join(",").trim()||"Kênh",logo:(m.match(/tvg-logo="([^"]*)"/)||[])[1]||"",group:(m.match(/group-title="([^"]*)"/)||[])[1]||"Khác",url:u,enabled:true})}return o}
app.post("/api/admin/import",auth,up.single("file"),async(q,s)=>{let d=parse(q.file.buffer.toString());if(col&&d.length)await col.insertMany(d);else mem.push(...d.map((x,i)=>({...x,_id:String(Date.now()+i)})));s.json({ok:true,imported:d.length})});
app.get("/admin",(q,s)=>s.sendFile(__dirname+"/public/admin.html"));app.get("/health",(q,s)=>s.json({ok:true,mongo:!!col}));
