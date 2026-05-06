const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname,'..','dist','ai.js'),'utf8');
const m = src.match(/const code = `([\s\S]*?)`;/);
if(!m){ console.error('code string not found'); process.exit(2); }
const code = m[1];
console.log('--- first 300 lines of worker blob ---');
console.log(code.split('\n').slice(0,300).map((l,i)=>`${i+1}: ${l}`).join('\n'));
console.log('--- end snippet ---');
try{
  // Attempt to parse without executing by creating a function
  new Function(code);
  console.log('OK: worker code parsed by Function constructor (no syntax error)');
} catch (e){
  console.error('PARSE ERROR:', e && e.stack || e);
  // try to show context lines near error if possible
  const m2 = e && e.stack && e.stack.match(/<anonymous>:(\d+):(\d+)/);
  if(m2){
    const line = Number(m2[1]);
    const col = Number(m2[2]);
    const lines = code.split('\n');
    const start = Math.max(0,line-6);
    const end = Math.min(lines.length, line+4);
    console.error(`Error context (worker blob) around ${line}:${col}:`);
    for(let i=start;i<end;i++){
      const mark = (i+1===line)?'>>':'  ';
      console.error(`${mark} ${i+1}: ${lines[i]}`);
    }
  }
  process.exit(1);
}
