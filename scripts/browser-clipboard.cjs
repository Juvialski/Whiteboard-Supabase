const { chromium }=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'chrome'});
 const context=await browser.newContext({viewport:{width:1600,height:900},permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage();
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIUlEQVR4nGP8z0AaYCJRPcOoBmIAE1GqkMCoBmIAyaEEAEAuAR9UPEsJAAAAAElFTkSuQmCC';
 const items=[{id:'img',type:'image',x:500,y:200,width:100,height:100,src:png,assetId:'fixture-image-asset',zIndex:1,rotation:90}, {id:'shape',type:'shape',shapeType:'rect',x:700,y:200,width:100,height:100,text:'shape',color:'#ffcc00',borderColor:'#000000',zIndex:2}, {id:'text',type:'text',x:900,y:200,width:140,height:80,text:'Browser test text',color:'#000000',fontSize:18,zIndex:3}, {id:'math',type:'math',x:1100,y:200,width:140,height:80,text:'x^2',color:'#000000',fontSize:18,zIndex:4}, {id:'draw',type:'drawing',points:[{x:500,y:430},{x:560,y:430},{x:600,y:440}],width:4,color:'#111111',isHighlighter:false,zIndex:5}, {id:'conn',type:'connector',fromId:'img',toId:'shape',fromSocket:'right',toSocket:'left',color:'#123456',zIndex:6}];
 await page.addInitScript(({items})=>{localStorage.setItem('WHITEBOARD_LOCAL_SANDBOX','true');localStorage.setItem('lucid_spark_user_role','teacher');localStorage.setItem('lucid_spark_board_elements_sandbox-board-1',JSON.stringify(items));window.__events=[]; for(const type of ['copy','paste']) window.addEventListener(type,e=>window.__events.push({type,trusted:e.isTrusted,types:[...(e.clipboardData?.types||[])]}),true);},{items});
 await page.goto('http://localhost:3000/'); await page.getByText('Enter Board',{exact:true}).click(); await page.locator('#shape-shape').waitFor(); await page.waitForFunction(() => document.querySelector('#image-img img')?.naturalWidth > 0);
 const get=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('lucid_spark_board_elements_sandbox-board-1')));
 for(const [type,id] of [['image','img'],['shape','shape'],['text','text'],['math','math'],['drawing','draw']]) {
   await page.keyboard.press('Escape');
   if(type==='drawing') await page.locator("path[stroke=\"#111111\"]").first().click({force:true}); else await page.locator('#'+type+'-'+id).click({position:{x:15,y:15}});
   let before=await get(); await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
   await page.waitForFunction(n=>JSON.parse(localStorage.getItem('lucid_spark_board_elements_sandbox-board-1')).length===n,before.length+1,{timeout:4000});
   let after=await get(); let copy=after.at(-1); assert.equal(copy.type,type); console.log('PASS',type,copy.id);
   await page.keyboard.press('Control+z'); await page.waitForFunction(n=>JSON.parse(localStorage.getItem('lucid_spark_board_elements_sandbox-board-1')).length===n,before.length);
 }

 await page.waitForTimeout(2200); await page.keyboard.press('Escape');
 await page.locator('#image-img').click({position:{x:15,y:15}});
 await page.locator('#shape-shape').click({position:{x:15,y:15},modifiers:['Shift']});
 let original=await get(); await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
 await page.waitForFunction(n=>JSON.parse(localStorage.getItem('lucid_spark_board_elements_sandbox-board-1')).length===n,original.length+3);
 let once=await get(); let group=once.slice(-3), image=group.find(x=>x.type==='image'), shape=group.find(x=>x.type==='shape'), connector=group.find(x=>x.type==='connector');
 assert.equal(image.rotation,90); assert.equal(image.src,png); assert.equal(image.assetId,'fixture-image-asset'); assert.equal(connector.fromId,image.id); assert.equal(connector.toId,shape.id); assert.equal(image.x-original[0].x,shape.x-original[1].x);
 await page.keyboard.press('Control+v'); await page.waitForFunction(n=>JSON.parse(localStorage.getItem('lucid_spark_board_elements_sandbox-board-1')).length===n,original.length+6);
 let twice=await get(); assert.ok(twice.slice(-3).find(x=>x.type==='image').x>image.x);
 await page.keyboard.press('Control+z'); await page.waitForFunction(n=>JSON.parse(localStorage.getItem('lucid_spark_board_elements_sandbox-board-1')).length===n,original.length+3);
 await page.keyboard.press('Control+Shift+z'); await page.waitForFunction(n=>JSON.parse(localStorage.getItem('lucid_spark_board_elements_sandbox-board-1')).length===n,original.length+6);
 console.log('PASS multi-selection connector, repeated paste, undo and redo');
 // More than ten pastes must continue advancing rather than stack in one place.
 for (let i=0;i<9;i++) { const n=(await get()).length; await page.keyboard.press('Control+v'); await page.waitForFunction(n=>JSON.parse(localStorage.getItem('lucid_spark_board_elements_sandbox-board-1')).length===n,n+3); }
 const many=await get(), imageCopies=many.filter(x=>x.type==='image' && x.id.startsWith('copy-'));
 assert.ok(imageCopies.at(-1).x>imageCopies.at(-2).x); console.log('PASS repeated positioning beyond ten pastes');

 await page.waitForTimeout(2200); await page.keyboard.press('Escape'); await page.locator('#image-img').click({position:{x:15,y:15}}); let predup=await get();
 await context.clearPermissions(); await page.keyboard.press('Control+d'); await page.waitForFunction(n=>JSON.parse(localStorage.getItem('lucid_spark_board_elements_sandbox-board-1')).length===n,predup.length+1); console.log('PASS duplicate'); const beforeButton=(await get()).length; await page.getByRole('button',{name:'Duplicate selection (Ctrl+D)'}).click(); await page.waitForFunction(n=>JSON.parse(localStorage.getItem('lucid_spark_board_elements_sandbox-board-1')).length===n,beforeButton+1); console.log('PASS accessible duplicate button');
 await page.waitForTimeout(3200); await context.grantPermissions(['clipboard-read','clipboard-write']); await page.evaluate(async ()=>{const canvas=document.createElement('canvas'); canvas.width=8; canvas.height=8; canvas.getContext('2d').fillRect(0,0,8,8); const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')); await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);});
 let preimage=await get(); await page.keyboard.press('Control+v'); await page.waitForFunction(n=>JSON.parse(localStorage.getItem('lucid_spark_board_elements_sandbox-board-1')).length===n,preimage.length+1,{timeout:10000}); assert.equal((await get()).at(-1).type,'image'); console.log('PASS external image clipboard');
 const events=await page.evaluate(()=>window.__events); assert.ok(events.filter(e=>e.type==='copy' && e.trusted).length >= 6); assert.ok(events.some(e=>e.type==='paste' && e.trusted && e.types.includes('text/html'))); assert.ok(events.some(e=>e.type==='paste' && e.trusted && e.types.includes('Files'))); console.log('PASS trusted browser clipboard events');

 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
