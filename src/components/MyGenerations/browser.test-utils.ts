// Browser APIs required by the real UIKit modal in JSDOM.
window.matchMedia ??= ((query:string)=>({
  matches:false,media:query,onchange:null,
  addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return false;},
})) as typeof window.matchMedia;
