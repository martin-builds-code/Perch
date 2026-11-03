// Run locally; stdin is the eight-digit PIN. Output contains secrets: save privately.
import{readFileSync}from'node:fs';import{createHmac,randomBytes,scryptSync}from'node:crypto';
const pin=readFileSync(0,'utf8').trim();if(!/^\d{8}$/.test(pin))throw Error('Exactly eight digits required');
const pepper=randomBytes(32).toString('hex'),salt=randomBytes(16).toString('hex');
const verifier='s1:'+salt+':'+scryptSync(createHmac('sha256',pepper).update(pin).digest(),salt,32,{N:16384,r:8,p:1}).toString('hex');
console.log(JSON.stringify({AERO_PIN_PEPPER:pepper,AERO_PIN_VERIFIER:verifier,AERO_SESSION_SECRET:randomBytes(32).toString('hex')},null,2));
