const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async()=>{
  const [,,mode,outDir,...times]=process.argv;
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1080,height:1920}});
  await p.goto('file://'+__dirname+'/ad.html'); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(800);
  const fs=require('fs'); fs.mkdirSync(outDir,{recursive:true});
  if(mode==='test'){ for(const t of times){ await p.evaluate(t=>render(+t),t); await p.screenshot({path:`${outDir}/t${t}.jpg`,type:'jpeg',quality:70}); } }
  else { const N=+times[0]; for(let i=0;i<N;i++){ await p.evaluate(t=>render(t),i/30); await p.screenshot({path:`${outDir}/f${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:92}); if(i%150==0) console.log(i);} }
  await b.close();
})();
