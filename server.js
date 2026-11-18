const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const W = 960, H = 540;
const platforms = [
  {x:0,y:500,w:960,h:40},
  {x:110,y:420,w:170,h:18},
  {x:350,y:350,w:150,h:18},
  {x:590,y:420,w:160,h:18},
  {x:760,y:320,w:120,h:18},
  {x:40,y:270,w:130,h:18}
];
const spawn = (i) => ({ x: i===0 ? 55 : 95, y: 450, vx:0, vy:0, w:28, h:38, onGround:false, alive:true, facing:1 });
const makeRoom = (code) => ({
  code, players: {}, coins: [{x:190,y:385},{x:415,y:315},{x:650,y:385},{x:815,y:285},{x:95,y:235}],
  collected: [], door: {x:900,y:450,w:42,h:50}, won:false, startedAt: Date.now()
});
function publicState(room) {
  return {
    players: Object.fromEntries(Object.entries(room.players).map(([id,p]) => [id, {
      x:p.x,y:p.y,vx:p.vx,vy:p.vy,w:p.w,h:p.h,facing:p.facing,alive:p.alive,
      name:p.name, color:p.color
    }])),
    coins: room.coins.filter((c,i)=>!room.collected.includes(i)),
    collected: room.collected.length, total: room.coins.length, won: room.won,
    playerCount: Object.keys(room.players).length, platforms, door:room.door
  };
}
function collide(a,b) {
  return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}
io.on("connection", socket => {
  socket.on("joinGame", ({code, name}) => {
    code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
    if (!code) code = Math.random().toString(36).slice(2,6).toUpperCase();
    let room = rooms.get(code);
    if (!room) { room = makeRoom(code); rooms.set(code, room); }
    if (Object.keys(room.players).length >= 2) {
      socket.emit("joinError", "这个房间已经有两名玩家，请创建新房间。"); return;
    }
    const index = Object.keys(room.players).length;
    const p = spawn(index);
    p.name = String(name || `玩家${index+1}`).slice(0,12);
    p.color = index===0 ? "#69d2e7" : "#ffb347";
    room.players[socket.id] = p;
    socket.join(code);
    socket.data.room = code;
    socket.emit("joined", {code, playerIndex:index, state:publicState(room)});
    io.to(code).emit("state", publicState(room));
  });
  socket.on("input", input => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.players[socket.id] || room.won) return;
    const p = room.players[socket.id];
    const left = !!input.left, right = !!input.right, jump = !!input.jump;
    const speed = 3.8;
    p.vx = (right?speed:0) - (left?speed:0);
    if (p.vx) p.facing = p.vx > 0 ? 1 : -1;
    if (jump && p.onGround) { p.vy = -10.8; p.onGround = false; }
  });
  socket.on("restart", () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    room.collected=[]; room.won=false;
    Object.keys(room.players).forEach((id,i)=>Object.assign(room.players[id],spawn(i)));
    io.to(room.code).emit("state",publicState(room));
  });
  socket.on("disconnect", () => {
    const code = socket.data.room, room = rooms.get(code);
    if (!room) return;
    delete room.players[socket.id];
    if (!Object.keys(room.players).length) rooms.delete(code);
    else io.to(code).emit("state",publicState(room));
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.won) continue;
    for (const [id,p] of Object.entries(room.players)) {
      p.vy += 0.48;
      p.x += p.vx;
      p.x = Math.max(0,Math.min(W-p.w,p.x));
      // Horizontal collision
      for (const pl of platforms) if (collide(p,pl)) {
        if (p.vx > 0) p.x = pl.x-p.w;
        else if (p.vx < 0) p.x = pl.x+pl.w;
      }
      const oldY = p.y;
      p.y += p.vy;
      p.onGround = false;
      for (const pl of platforms) {
        if (collide(p,pl)) {
          if (p.vy >= 0 && oldY+p.h <= pl.y+8) {
            p.y = pl.y-p.h; p.vy=0; p.onGround=true;
          } else if (p.vy < 0) { p.y=pl.y+pl.h; p.vy=0; }
        }
      }
      if (p.y > H+100) Object.assign(p,spawn(Object.keys(room.players).indexOf(id)));
      for (let i=0;i<room.coins.length;i++) {
        if (!room.collected.includes(i) && collide(p,{x:room.coins[i].x-10,y:room.coins[i].y-10,w:20,h:20})) room.collected.push(i);
      }
    }
    const ps = Object.values(room.players);
    if (room.collected.length===room.coins.length && ps.length===2 && ps.every(p=>collide(p,room.door))) room.won=true;
    io.to(room.code).emit("state",publicState(room));
  }
}, 1000/30);

server.listen(PORT, "0.0.0.0", () => console.log(`Pixel co-op game running on port ${PORT}`));
