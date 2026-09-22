import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const wb = await SpreadsheetFile.importXlsx(await FileBlob.load("D:/embed/CombinedCards.xlsx"));
const sh = wb.worksheets.getItem("Results");
const rows = sh.getRange("A4:I1605").values.filter(r=>r[0]&&r[3]!=null&&r[4]!=null).map((r,i)=>({
 row:i+4,date:String(r[0]),ts:Date.parse(String(r[0])),day:String(r[0]).slice(0,11),cashier:String(r[1]),computer:String(r[2]),from:String(r[3]),to:String(r[4]),cash:+r[5]||0,bonus:+r[6]||0,free:+r[7]||0,tickets:+r[8]||0
}));

const byDest=new Map();
for(const r of rows){if(!byDest.has(r.to))byDest.set(r.to,[]);byDest.get(r.to).push(r)}
const summaries=[...byDest].map(([to,rs])=>({to,count:rs.length,sources:new Set(rs.map(r=>r.from)).size,days:new Set(rs.map(r=>r.day)).size,cash:+rs.reduce((s,r)=>s+r.cash,0).toFixed(2),bonus:+rs.reduce((s,r)=>s+r.bonus,0).toFixed(2),tickets:rs.reduce((s,r)=>s+r.tickets,0),cashiers:[...new Set(rs.map(r=>r.cashier))]}));

const clusters=[];
for(const [to,rs] of byDest){
 const byDay=new Map(); for(const r of rs){if(!byDay.has(r.day))byDay.set(r.day,[]);byDay.get(r.day).push(r)}
 for(const [day,ds] of byDay) if(ds.length>=4){const times=ds.map(r=>r.ts);clusters.push({to,day,count:ds.length,sources:new Set(ds.map(r=>r.from)).size,cash:+ds.reduce((s,r)=>s+r.cash,0).toFixed(2),tickets:ds.reduce((s,r)=>s+r.tickets,0),cashiers:[...new Set(ds.map(r=>r.cashier))],durationMinutes:+((Math.max(...times)-Math.min(...times))/60000).toFixed(1),rows:ds.map(r=>r.row)})}
}

const focus="418656825"; const fr=byDest.get(focus)||[];
const focusByDay={}; for(const r of fr){if(!focusByDay[r.day])focusByDay[r.day]={count:0,cash:0,tickets:0,cashiers:new Set(),rows:[]};const d=focusByDay[r.day];d.count++;d.cash+=r.cash;d.tickets+=r.tickets;d.cashiers.add(r.cashier);d.rows.push(r.row)}
for(const d of Object.values(focusByDay)){d.cash=+d.cash.toFixed(2);d.cashiers=[...d.cashiers]}

console.log(JSON.stringify({
 totals:{transactions:rows.length,destinations:byDest.size},
 topDestinations:summaries.sort((a,b)=>b.count-a.count).slice(0,15),
 largestSameDayClusters:clusters.sort((a,b)=>b.count-a.count||b.cash-a.cash).slice(0,25),
 largestCashTransactions:[...rows].sort((a,b)=>b.cash-a.cash).slice(0,15),
 largestTicketTransactions:[...rows].sort((a,b)=>b.tickets-a.tickets).slice(0,15),
 focus418656825:{summary:summaries.find(s=>s.to===focus),byDay:focusByDay},
 selfTransfers:rows.filter(r=>r.from===r.to),
},null,2));
