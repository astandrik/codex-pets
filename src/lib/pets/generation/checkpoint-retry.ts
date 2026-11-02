export type CheckpointRetryOptions = {
  attempts?: number; budgetMs?: number; now?:()=>number; wait?:(ms:number)=>Promise<void>; random?:()=>number;
  shouldRetry?:(error:unknown)=>boolean; onError?:(error:unknown,pass:number)=>void;
};
export async function retryCheckpoint<T>(run:()=>Promise<T>,options:CheckpointRetryOptions={}):Promise<T>{
  const now=options.now??Date.now,start=now(),max=options.attempts??10,budget=options.budgetMs??120000;
  if(!Number.isSafeInteger(max)||max<1||max>10||!Number.isFinite(budget)||budget<=0||budget>120000)throw Error("Invalid checkpoint retry bounds");
  for(let pass=1;;pass++){
    try{return await run();}catch(error){
      try{options.onError?.(error,pass);}catch{ /* Logging cannot alter recovery. */ }
      if(pass>=max||options.shouldRetry?.(error)===false)throw error;
      const cap=Math.min(5000,250*2**Math.min(pass-1,5));
      const delay=Math.floor(cap*Math.max(0,Math.min(1,options.random?.()??Math.random())));
      if(now()+delay>=start+budget)throw error;
      await (options.wait??(ms=>new Promise(r=>setTimeout(r,ms))))(delay);
      if(now()>=start+budget)throw error;
    }
  }
}
