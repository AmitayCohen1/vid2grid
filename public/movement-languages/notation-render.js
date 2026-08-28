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

  function merge(pose, boneOverrides){ const p = clonePose(pose); for (const k in boneOverrides) p.bones[k] = boneOverrides[k].slice(); return p; }

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

  // --- Laban quantization + symbol: verbatim from danceforms.html:855-900 ---
  const DIR8=["forward","rf","right","rb","back","lb","left","lf"];
  const DIR16=["forward","f/rf","rf","rf/r","right","r/rb","rb","rb/b","back","b/lb","lb","lb/l","left","l/lf","lf","lf/f"];
  const DIR_ARROW={forward:"↑",rf:"↗",right:"→",rb:"↘",back:"↓",lb:"↙",left:"←",lf:"↖",place:"●",
    "f/rf":"↑↗","rf/r":"↗→","r/rb":"→↘","rb/b":"↘↓","b/lb":"↓↙","lb/l":"↙←","l/lf":"←↖","lf/f":"↖↑"};
  function labanOf(v){
    const ae=dirToAzEl(v), az=ae[0], el=ae[1];
    if(el>67.5) return {dir:"place",level:"high",pin:0};
    if(el<-67.5) return {dir:"place",level:"low",pin:0};
    const level = el>22.5?"high": el<-22.5?"low":"middle";
    const base={high:45,middle:0,low:-45}[level];
    const pin = (el-base)>11.25? 1 : (el-base)<-11.25? -1 : 0;
    const i16=((Math.round(az/22.5)%16)+16)%16;
    return {dir:DIR16[i16], level, pin};
  }
  function hatchDef(id){
    return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" style="stroke:var(--ink);stroke-width:1.3"/></pattern>`;
  }
  function labanSymbol(dir, level, x, y, w, h, mirror){
    const fill = level==="low" ? "var(--ink)" : level==="high" ? "url(#lhatch)" : "var(--card)";
    const nw=w*0.5, nh=Math.min(h*0.35,12);
    let d;
    switch(dir){
      case "place": d=`M${x},${y} h${w} v${h} h${-w} Z`; break;
      case "forward": d = mirror
        ? `M${x},${y+nh} h${nw} v${-nh} h${w-nw} v${h} h${-w} Z`
        : `M${x},${y} h${nw} v${nh} h${w-nw} v${h-nh} h${-w} Z`; break;
      case "back": d = mirror
        ? `M${x},${y} h${w} v${h} h${-(w-nw)} v${-nh} h${-nw} Z`
        : `M${x},${y} h${w} v${h-nh} h${-(w-nw)} v${nh} h${-nw} Z`; break;
      case "right": d=`M${x},${y} h${w*0.55} L${x+w},${y+h/2} L${x+w*0.55},${y+h} h${-w*0.55} Z`; break;
      case "left":  d=`M${x+w*0.45},${y} h${w*0.55} v${h} h${-w*0.55} L${x},${y+h/2} Z`; break;
      case "rf": d=`M${x},${y+nh} L${x+w*0.55},${y+nh} L${x+w},${y} L${x+w},${y+h} L${x},${y+h} Z`; break;
      case "lf": d=`M${x},${y} L${x+w*0.45},${y+nh} L${x+w},${y+nh} L${x+w},${y+h} L${x},${y+h} Z`; break;
      case "rb": d=`M${x},${y} L${x+w},${y} L${x+w},${y+h} L${x+w*0.55},${y+h-nh} L${x},${y+h-nh} Z`; break;
      case "lb": d=`M${x},${y} L${x+w},${y} L${x+w},${y+h-nh} L${x+w*0.45},${y+h-nh} L${x},${y+h} Z`; break;
      default: d=`M${x},${y} h${w} v${h} h${-w} Z`;
    }
    const dot = level==="middle" ? `<circle cx="${x+w/2}" cy="${y+h/2}" r="2.2" fill="var(--ink)"/>` : "";
    return `<path d="${d}" fill="${fill}" style="stroke:var(--ink);stroke-width:1.4" stroke-linejoin="miter"/>${dot}`;
  }

  /* ---- Laban view ---- */
  const LABAN_COLS=["larm","lleg","rleg","rarm","body","head"];
  const SEG_TO_LABANCOL = { luarm:"larm", lfarm:"larm", ruarm:"rarm", rfarm:"rarm",
    lthigh:"lleg", lshin:"lleg", rthigh:"rleg", rshin:"rleg", torso:"body", head:"head" };
  function segToLabanCol(seg){ return SEG_TO_LABANCOL[seg] || (LIMBSETS[seg] ? seg : null); }
  function labanQuantAt(d, part, ki){ return labanOf(limbVec(d.keys[ki].pose, part)); }
  function renderLaban(dancer, opts){
    opts = opts || {};
    const d = dancer;
    const T = dancer.beats;
    if (!d || !d.keys.length) return "";
    const beatH=34, top=24, bottom=80;
    const H=T*beatH+top+bottom;
    const colW=54, symW=34, gap=12, cx=230;
    const colX={ larm:cx-2*colW-gap-12, lleg:cx-colW-12, rleg:cx+12, rarm:cx+colW+gap+12,
                 body:cx+2*colW+gap+44, head:cx+3*colW+gap+52 };
    const focusCol = opts.focusSegment ? segToLabanCol(opts.focusSegment) : null;
    let g=`<defs>${hatchDef("lhatch")}</defs>`;
    g+=`<line x1="${cx-3}" y1="${top-8}" x2="${cx-3}" y2="${H-bottom+10}" style="stroke:var(--ink);stroke-width:1.5"/>`;
    g+=`<line x1="${cx+3}" y1="${top-8}" x2="${cx+3}" y2="${H-bottom+10}" style="stroke:var(--ink);stroke-width:1.5"/>`;
    g+=`<line x1="${colX.body+symW/2}" y1="${top-8}" x2="${colX.body+symW/2}" y2="${H-bottom+10}" style="stroke:var(--line);stroke-width:1"/>`;
    g+=`<line x1="${colX.head+symW/2}" y1="${top-8}" x2="${colX.head+symW/2}" y2="${H-bottom+10}" style="stroke:var(--line);stroke-width:1"/>`;
    // start double bar + beat ticks
    g+=`<line x1="${colX.larm-18}" y1="${H-bottom+4}" x2="${colX.head+symW+18}" y2="${H-bottom+4}" style="stroke:var(--ink);stroke-width:1.3"/>`;
    g+=`<line x1="${colX.larm-18}" y1="${H-bottom+9}" x2="${colX.head+symW+18}" y2="${H-bottom+9}" style="stroke:var(--ink);stroke-width:1.3"/>`;
    for(let b=0;b<=T;b+=4){
      const y=H-bottom-b*beatH;
      g+=`<line x1="${colX.larm-18}" y1="${y}" x2="${colX.larm-6}" y2="${y}" style="stroke:var(--line)"/>`;
      g+=`<text x="${colX.larm-24}" y="${y+4}" text-anchor="end" class="mono" font-size="12" fill="var(--ink-faint)">${b}</text>`;
    }
    // column labels (staggered)
    LABAN_COLS.forEach((p,i)=>{
      g+=`<text x="${colX[p]+symW/2}" y="${H-(i%2?22:42)}" text-anchor="middle" font-size="11.5" fill="var(--ink-soft)" font-family="Futura,'Avenir Next',sans-serif" style="letter-spacing:.08em">${LIMBSETS[p].label.toUpperCase()}</text>`;
    });
    // symbols + slots
    d.keys.forEach((k,ki)=>{
      const nextBeat = ki<d.keys.length-1? d.keys[ki+1].beat : T;
      const y1=H-bottom-k.beat*beatH, y0=H-bottom-nextBeat*beatH;
      for(const p of LABAN_COLS){
        g += `<g class="${focusCol ? (p===focusCol ? "focus" : "dim") : ""}" data-col="${p}">`;
        const q=labanQuantAt(d,p,ki);
        const held = ki>0 && JSON.stringify(q)===JSON.stringify(labanQuantAt(d,p,ki-1));
        const x=colX[p]+(colW-symW)/2-8;
        const sel = false;
        if(!held){
          const i16=DIR16.indexOf(q.dir);
          const h=Math.max(8,(y1-y0)-4);
          let sym;
          if(q.dir==="place"||i16%2===0) sym=labanSymbol(q.dir==="place"?"place":DIR8[i16/2],q.level,x,y0+2,symW,h,p[0]==="l");
          else sym=labanSymbol(DIR8[((i16-1)/2)%8],q.level,x,y0+2,symW/2,h,p[0]==="l")
                  +labanSymbol(DIR8[(((i16+1)/2))%8],q.level,x+symW/2,y0+2,symW/2,h,p[0]==="l");
          if(q.pin) sym+=`<path d="M${x+symW/2-3.5},${q.pin>0?y0+6:y0+h-2} l3.5,${q.pin>0?-4:4} l3.5,${q.pin>0?4:-4}" fill="none" style="stroke:var(--ink);stroke-width:1.3"/>`;
          g+=`<g style="pointer-events:none">${sym}</g>`;
        }
        else g+=`<line x1="${x+symW/2}" y1="${y0+3}" x2="${x+symW/2}" y2="${y1-3}" style="stroke:var(--ink-faint);stroke-width:1" stroke-dasharray="1 4" pointer-events="none"/>`;
        g+=`<rect class="lslot" data-k="${ki}" data-part="${p}" x="${x-4}" y="${y0}" width="${symW+8}" height="${y1-y0}" fill="transparent" style="cursor:pointer;${sel?"stroke:var(--accent);stroke-width:1.2;stroke-dasharray:3 3":""}"/>`;
        g += `</g>`;
      }
    });
    const W=colX.head+symW+70;
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:none">${g}</svg>`;
  }

  return { BONES, BONE, LIMBSETS, standPose, clonePose, merge, skeleton, limbVec, setLimbVec, vec, rotY, dirToAzEl, renderLaban };
});
