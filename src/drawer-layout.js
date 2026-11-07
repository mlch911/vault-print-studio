export const frameRoles=new Set(['body','latch','roof','handle','roof-insert']);
export const runnerRoles=new Set(['runner-guide','runner-slide','runner-stopper']);
export const drawerHeight=h=>({'1F':1,'2F':2,'4F':4})[h]||0;
export function drawerLayoutProblem(c){
 if(c.drawers===undefined)return '';
 if(c.kind!=='drawer'||!Array.isArray(c.drawers)||!c.drawers.length||c.drawers.length>4||c.drawers.some(h=>!drawerHeight(h)))return '框内抽屉需选择 1–4 个有效的 1F、2F 或 4F 抽屉。';
 if(c.drawers.reduce((n,h)=>n+drawerHeight(h),0)>drawerHeight(c.h))return '框内抽屉总层高不能超过外框层高。';
 if(c.w==='XL'&&(c.drawers.length!==1||c.drawers[0]!=='1F'))return 'XL 目录仅提供 1F 抽屉。';
 return '';
}
export function drawerLayouts(h){
 const capacity=drawerHeight(h),out=[];
 const visit=(parts,left)=>{if(parts.length)out.push(parts);if(parts.length>=4)return;for(const next of ['1F','2F','4F'])if(drawerHeight(next)<=left)visit([...parts,next],left-drawerHeight(next));};
 visit([],capacity);
 return out.sort((a,b)=>(b.reduce((s,h)=>s+drawerHeight(h),0)-a.reduce((s,h)=>s+drawerHeight(h),0))||a.length-b.length);
}
export function drawerLayoutLabel(parts,h){
 const unused=drawerHeight(h)-parts.reduce((n,v)=>n+drawerHeight(v),0);
 return parts.map((v,i)=>`${i+1}号 ${v}`).join(' ＋ ')+(unused?` · 顶部空余 ${unused}F`:'');
}
export function tierColumns(tier){return tier.columns||tier.ids.map(id=>[id]);}
export function withColumns(tier,columns){return {...tier,columns:columns.map(c=>c.slice()),ids:columns.flat()};}
