import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load("D:/embed/CombinedCards.xlsx"));
const sh=wb.worksheets.getItem("Results");
const rows=sh.getRange("A4:I1605").values.filter(r=>r[0]&&r[4]!=null).map((r,i)=>({row:i+4,date:String(r[0]),from:String(r[3]),to:String(r[4]),cash:+r[5]||0,bonus:+r[6]||0,tickets:+r[8]||0}));
const m=new Map();
for(const r of rows){if(!m.has(r.to))m.set(r.to,{card:r.to,transfers:0,sources:new Set(),cash:0,bonus:0,tickets:0,rows:[]});const x=m.get(r.to);x.transfers++;x.sources.add(r.from);x.cash+=r.cash;x.bonus+=r.bonus;x.tickets+=r.tickets;x.rows.push(r.row)}
const a=[...m.values()].map(x=>({card:x.card,transfers:x.transfers,sources:x.sources.size,cash:+x.cash.toFixed(2),bonus:+x.bonus.toFixed(2),tickets:x.tickets,minRow:Math.min(...x.rows),maxRow:Math.max(...x.rows)}));
console.log(JSON.stringify({topCash:[...a].sort((x,y)=>y.cash-x.cash).slice(0,12),topTickets:[...a].sort((x,y)=>y.tickets-x.tickets).slice(0,12),topBonus:[...a].sort((x,y)=>y.bonus-x.bonus).slice(0,8)},null,2));
