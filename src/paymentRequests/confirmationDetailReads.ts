// Workspace-local queue: no data or authorization cache shared between users.
export function createConfirmationDetailReads(){
 let active=0;
 const waiting:Array<()=>void>=[];
 return <T,>(read:()=>Promise<T>):Promise<T>=>new Promise<T>((resolve,reject)=>{
  const start=()=>{active++;void read().then(resolve,reject).finally(()=>{active--;waiting.shift()?.();});};
  if(active<4)start();else waiting.push(start);
 });
}
