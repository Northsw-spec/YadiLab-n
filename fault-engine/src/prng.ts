function mixText(seed: number, text: string): number {
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (let i=0;i<text.length;i+=1) { h ^= text.charCodeAt(i); h = Math.imul(h,16777619)>>>0; }
  return h || 0x9e3779b9;
}
function xorshift32(value: number): number {
  let x=value>>>0; x ^= x<<13; x ^= x>>>17; x ^= x<<5; return x>>>0;
}
export function deterministicChoiceIndex(seed:number, namespace:string, length:number): number {
  if (!Number.isInteger(seed) || seed<0 || seed>0xffffffff) throw new Error("seed must be uint32");
  if (!Number.isInteger(length)||length<1) throw new Error("choice length must be positive");
  return xorshift32(mixText(seed,namespace)) % length;
}
