import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { isAppPage, externalLink, signInTicket, providerLink, DESKTOP_CSP } from '../desktop/security.mjs';
import { createLocalServer } from '../server/local-server.mjs';
import { ChatGPTError } from '../server/chatgpt-auth.mjs';

test('desktop trusts only its own main page and blocks executable external protocols', () => {
  assert.equal(isAppPage('http://localhost:4173/'), true);
  assert.equal(isAppPage('http://localhost:4173/index.html#notes'), true);
  for (const url of ['https://evil.test/', 'http://localhost:4174/', 'http://127.0.0.1:4173/', 'http://localhost:4173/auth/callback', 'http://user@localhost:4173/', 'file:///test', 'not a URL']) assert.equal(isAppPage(url), false, url);
  assert.equal(externalLink('https://chatgpt.com/'), 'https://chatgpt.com/');
  assert.equal(externalLink('mailto:test@example.com'), 'mailto:test@example.com');
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows/system32/cmd.exe', 'ms-settings:', 'data:text/html,test', 'https://user:password@evil.test/']) assert.equal(externalLink(url), '');
  assert.equal(DESKTOP_CSP.includes("'unsafe-eval'"), false);assert.match(DESKTOP_CSP, /script-src 'self'/);
});
test('desktop sign-in bridge accepts one local ticket and only the pinned OpenAI destination', () => {
  const ticket = 'a'.repeat(43);assert.equal(signInTicket('http://localhost:4173/api/chatgpt/authorize?ticket='+ticket), ticket);
  for(const value of ['https://evil.test/api/chatgpt/authorize?ticket='+ticket,'http://localhost:4173/?ticket='+ticket,'http://localhost:4173/api/chatgpt/authorize?ticket='+ticket+'&ticket='+ticket,'http://localhost:4173/api/chatgpt/authorize?ticket='+ticket+'&extra=1','http://localhost:4173/api/chatgpt/authorize?ticket=short']) assert.throws(()=>signInTicket(value));
  assert.equal(providerLink('https://auth.openai.com/api/accounts/authorize?state=test'),'https://auth.openai.com/api/accounts/authorize?state=test');
  for(const value of ['https://evil.test/api/accounts/authorize','https://auth.openai.com/not-authorize','https://user@auth.openai.com/api/accounts/authorize']) assert.throws(()=>providerLink(value));
});
async function preloadHarness(){
 const source=await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');const listeners=new Map(),sent=[],invoked=[],events=[];let bridge;
 const electron={contextBridge:{exposeInMainWorld:(name,api)=>{assert.equal(name,'slateDesktop');bridge=api;}},ipcRenderer:{invoke:async(...args)=>{invoked.push(args);},on:(name,handler)=>listeners.set(name,handler),send:(...args)=>sent.push(args)}};
 vm.runInNewContext(source,{require:name=>{assert.equal(name,'electron');return electron;},window:{dispatchEvent:event=>events.push(event.type)},Event:class{constructor(type){this.type=type;}},TypeError});
 return {bridge,listeners,sent,invoked,events};
}
test('preload exposes narrow operations and reports save completion before closing',async()=>{
 const h=await preloadHarness();assert.deepEqual(Object.keys(h.bridge).sort(),['mcp','onBeforeClose','openSignIn']);
 assert.deepEqual(Object.keys(h.bridge.mcp).sort(),['config','onCall','regenerate','set']);
 await h.bridge.openSignIn('local ticket URL');assert.deepEqual(h.invoked,[['slate:sign-in','local ticket URL']]);
 let saved=false;const stop=h.bridge.onBeforeClose(async()=>{await Promise.resolve();saved=true;return true;});
 await h.listeners.get('slate:request-close')();assert.equal(saved,true);assert.deepEqual(h.sent.pop(),['slate:close-ready',true]);
 stop();await h.listeners.get('slate:request-close')();assert.deepEqual(h.sent.pop(),['slate:close-ready',true]);
 h.listeners.get('slate:open-settings')();assert.deepEqual(h.events,['slate-open-settings']);
});
test('preload reports failure when saving fails instead of permitting a silent close',async()=>{
 const h=await preloadHarness();h.bridge.onBeforeClose(async()=>{throw Error('Save failed');});await h.listeners.get('slate:request-close')();assert.deepEqual(h.sent,[['slate:close-ready',false]]);
 h.bridge.onBeforeClose(async()=>false);await h.listeners.get('slate:request-close')();assert.deepEqual(h.sent.at(-1),['slate:close-ready',false]);
});
test('shared local server serves packaged files with CSP and rejects traversal and unsupported methods',async(t)=>{
 const directory=await mkdtemp(path.join(tmpdir(),'slate-desktop-server-'));const root=path.join(directory,'dist');await mkdir(root);await writeFile(path.join(root,'index.html'),'<h1>Slate fixture</h1>');await writeFile(path.join(directory,'private.txt'),'private');
 const local=createLocalServer({root,contentSecurityPolicy:DESKTOP_CSP,runtime:{status:async()=>({available:true})}});const origin=await local.listen(0);t.after(async()=>{await local.close();await rm(directory,{recursive:true,force:true});});
 const page=await fetch(origin+'/');assert.equal(await page.text(),'<h1>Slate fixture</h1>');assert.equal(page.headers.get('content-security-policy'),DESKTOP_CSP);
 const head=await fetch(origin+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await fetch(origin+'/..%2Fprivate.txt')).status,403);assert.equal((await fetch(origin+'/',{method:'POST'})).status,405);
 const status=await (await fetch(origin+'/api/chatgpt/session')).json();assert.equal(status.available,true);assert.equal(typeof status.requestToken,'string');
});
test('closing the desktop service aborts an in-flight answer',async(t)=>{
 const directory=await mkdtemp(path.join(tmpdir(),'slate-desktop-cancel-'));t.after(()=>rm(directory,{recursive:true,force:true}));let aborted=false;
 const runtime={status:async()=>({available:true}),respond:async(_,delta,signal)=>{delta('partial');await new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));throw new ChatGPTError('Stopped','cancelled',499);}};
 const local=createLocalServer({root:directory,runtime});const origin=await local.listen(0);
 const session=await (await fetch(origin+'/api/chatgpt/session')).json();const answer=await fetch(origin+'/api/chatgpt/respond',{method:'POST',headers:{'Content-Type':'application/json','X-Slate-Token':session.requestToken},body:JSON.stringify({model:'test',input:[{role:'user',content:'note'}]})});
 await answer.body.getReader().read();await local.close();assert.equal(aborted,true);
});
test('preload passes AI-app tool calls to the page handler and returns results or errors',async()=>{
 const h=await preloadHarness();const same=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b));
 await h.listeners.get('slate:mcp-call')({}, {id:'a',name:'list_pages',args:{}});same(h.sent.pop(),['slate:mcp-result','a',{error:'Open Slate first: the Slate window is still loading.'}]);
 h.bridge.mcp.onCall(async(name,args)=>({name,args}));same(h.sent.pop(),['slate:mcp-ready']);
 await h.listeners.get('slate:mcp-call')({}, {id:'b',name:'get_page',args:{id:'p'}});same(h.sent.pop(),['slate:mcp-result','b',{value:{name:'get_page',args:{id:'p'}}}]);
 h.bridge.mcp.onCall(async()=>{throw Error('No page');});h.sent.pop();
 await h.listeners.get('slate:mcp-call')({}, {id:'c',name:'get_page',args:{}});same(h.sent.pop(),['slate:mcp-result','c',{error:'No page'}]);
 await h.bridge.mcp.set({enabled:true,remoteUrl:'https://x.test',extra:'dropped'});same(h.invoked.pop(),['slate:mcp-set',{enabled:true,remoteUrl:'https://x.test'}]);
});
