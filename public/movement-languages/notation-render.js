/* notation-render.js — React-free twin of the pose model + the three notation
   renderers embedded in danceforms.html. SOURCE OF TRUTH: danceforms.html.
   Ported verbatim; only DOM/selection coupling is removed (see comparison spec
   2026-08-28). Keep in step with danceforms.html by hand until it is unfrozen. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NotationRender = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // --- math: verbatim from danceforms.html:521-532 ---
  const D2R = Math.PI / 180;
  function vec(az, el){ const a=az*D2R, e=el*D2R; return {x:Math.sin(a)*Math.cos(e), y:Math.sin(e), z:Math.cos(a)*Math.cos(e)}; }
  function rotY(v, deg){ const r=deg*D2R, c=Math.cos(r), s=Math.sin(r); return {x:v.x*c+v.z*s, y:v.y, z:-v.x*s+v.z*c}; }
  function dirToAzEl(v){ return [Math.atan2(v.x,v.z)/D2R, Math.asin(Math.max(-1,Math.min(1,v.y)))/D2R]; }

  // --- bones + pose: verbatim from danceforms.html:429-457 (BONES, BONE, STAND, clonePose) ---
  const BONES = [
    {id:"torso",  label:"Torso",     from:"pelvis",   len:0.44},
    {id:"head",   label:"Head",      from:"neck",     len:0.15},
    {id:"ruarm",  label:"R upper arm",from:"rshoulder",len:0.27},
    {id:"rfarm",  label:"R forearm", from:"relbow",   len:0.25},
    {id:"luarm",  label:"L upper arm",from:"lshoulder",len:0.27},
    {id:"lfarm",  label:"L forearm", from:"lelbow",   len:0.25},
    {id:"rthigh", label:"R thigh",   from:"rhip",     len:0.42},
    {id:"rshin",  label:"R shin",    from:"rknee",    len:0.40},
    {id:"lthigh", label:"L thigh",   from:"lhip",     len:0.42},
    {id:"lshin",  label:"L shin",    from:"lknee",    len:0.40},
  ];
  const BONE = Object.fromEntries(BONES.map(b=>[b.id,b]));

  const STAND = {
    hipY:0.98, x:0, z:0, facing:0,
    bones:{
      torso:[0,86], head:[0,76],
      ruarm:[16,-74], rfarm:[10,-84], luarm:[-16,-74], lfarm:[-10,-84],
      rthigh:[5,-86], rshin:[2,-89], lthigh:[-5,-86], lshin:[-2,-89],
    }
  };
  function clonePose(p){ return JSON.parse(JSON.stringify(p)); }

  function standPose(){ return clonePose(STAND); }

  // --- skeleton FK: verbatim from danceforms.html:556-587 ---
  function skeleton(p){
    const F = p.facing;
    const W = v => rotY(v, F);
    const root = {x:p.x, y:p.hipY, z:p.z};
    const add=(a,v,s)=>({x:a.x+v.x*s, y:a.y+v.y*s, z:a.z+v.z*s});
    const seg=[];
    const torsoDir = W(vec(...p.bones.torso));
    const chest = add(root, torsoDir, BONE.torso.len);
    const rsh = add(chest, W({x:1,y:0,z:0}), 0.19);
    const lsh = add(chest, W({x:-1,y:0,z:0}), 0.19);
    const rhip = add(root, W({x:1,y:0,z:0}), 0.11);
    const lhip = add(root, W({x:-1,y:0,z:0}), 0.11);
    seg.push(["torso", root, chest]);
    seg.push(["clav", rsh, lsh]);
    seg.push(["pelvis", rhip, lhip]);
    const headDir = W(vec(...p.bones.head));
    const headEnd = add(chest, headDir, BONE.head.len);
    const relbow = add(rsh, W(vec(...p.bones.ruarm)), BONE.ruarm.len);
    const rwrist = add(relbow, W(vec(...p.bones.rfarm)), BONE.rfarm.len);
    const lelbow = add(lsh, W(vec(...p.bones.luarm)), BONE.luarm.len);
    const lwrist = add(lelbow, W(vec(...p.bones.lfarm)), BONE.lfarm.len);
    const rknee = add(rhip, W(vec(...p.bones.rthigh)), BONE.rthigh.len);
    const rankle = add(rknee, W(vec(...p.bones.rshin)), BONE.rshin.len);
    const lknee = add(lhip, W(vec(...p.bones.lthigh)), BONE.lthigh.len);
    const lankle = add(lknee, W(vec(...p.bones.lshin)), BONE.lshin.len);
    seg.push(["ruarm", rsh, relbow], ["rfarm", relbow, rwrist]);
    seg.push(["luarm", lsh, lelbow], ["lfarm", lelbow, lwrist]);
    seg.push(["rthigh", rhip, rknee], ["rshin", rknee, rankle]);
    seg.push(["lthigh", lhip, lknee], ["lshin", lknee, lankle]);
    const headC = add(chest, headDir, BONE.head.len+0.085);
    return {seg, headC, joints:[chest,relbow,lelbow,rknee,lknee,rwrist,lwrist,rankle,lankle], headEnd};
  }

  // --- limb helpers: verbatim from danceforms.html:832-852 (LIMBSETS, limbVec, setLimbVec, limbLen) ---
  const LIMBSETS = {
    larm:{label:"L arm", segs:["luarm","lfarm"]},
    lleg:{label:"L leg", segs:["lthigh","lshin"]},
    rleg:{label:"R leg", segs:["rthigh","rshin"]},
    rarm:{label:"R arm", segs:["ruarm","rfarm"]},
    body:{label:"Body", segs:["torso"]},
    head:{label:"Head", segs:["head"]},
  };
  function limbVec(pose,id){
    let x=0,y=0,z=0;
    for(const sid of LIMBSETS[id].segs){
      const v=vec(...pose.bones[sid]), L=BONE[sid].len;
      x+=v.x*L; y+=v.y*L; z+=v.z*L;
    }
    const m=Math.hypot(x,y,z)||1; return {x:x/m,y:y/m,z:z/m};
  }
  function setLimbVec(pose,id,v){
    const ae=dirToAzEl(v);
    for(const sid of LIMBSETS[id].segs) pose.bones[sid]=ae.slice();
  }
  function limbLen(id){ return LIMBSETS[id].segs.reduce((a,s)=>a+BONE[s].len,0); }

  return { BONES, BONE, LIMBSETS, standPose, clonePose, skeleton, limbVec, setLimbVec, vec, rotY, dirToAzEl };
});
