/**
 * The complete client runtime for the standalone build, as one string.
 *
 * Every behaviour the site has, in dependency-free JavaScript: the route, the
 * licence finder, the price comparison, the cockpit sequence, and each of the
 * sixteen bookmarked techniques. No framework, no CDN, nothing to fetch — the
 * file has to work when it is opened by double-click, on a machine with no
 * network, which is the whole point of this build.
 *
 * Conventions used throughout:
 *   • every scroll/pointer handler is rAF-throttled and writes styles directly
 *   • everything checks prefers-reduced-motion and simply does less
 *   • nothing here is required to read the page — it is all enhancement
 */
export const js = /* js */ `
(function(){
'use strict';
var RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
var FINE = matchMedia('(hover:hover) and (pointer:fine)').matches;
var $ = function(s,r){return (r||document).querySelector(s)};
var $$ = function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
function raf(fn){var t=0;return function(){if(t)return;t=requestAnimationFrame(function(){t=0;fn()})}}
function clamp(v,a,b){return v<a?a:v>b?b:v}
function progress(){var d=document.documentElement,r=d.scrollHeight-innerHeight;return r>0?clamp(scrollY/r,0,1):0}

/* ══ Header ═════════════════════════════════════════════ */
(function(){
  var h=$('.hdr'); if(!h) return;
  var on=raf(function(){
    if(scrollY>16) h.setAttribute('data-solid',''); else h.removeAttribute('data-solid');
    // Whatever sits behind the bar decides whether the bar is ink or paper.
    var under=document.elementsFromPoint(innerWidth/2, h.offsetHeight+4)
      .filter(function(e){return e.classList&&e.classList.contains('day')})[0];
    h.toggleAttribute('data-light', !!under);
  });
  on(); addEventListener('scroll',on,{passive:true});
  // The mobile sheet covers the page, so it has to behave like one: Escape
  // closes it, focus goes in and comes back, Tab stays inside while it is up,
  // and a link that only moves to an anchor on this page closes it too.
  var b=$('.burger'), m=$('.mnav');
  if(b&&m){
    var loop=function(){ return [b].concat([].slice.call(m.querySelectorAll('a,button'))) };
    var setOpen=function(open){
      m.toggleAttribute('data-open',open);
      document.body.style.overflow=open?'hidden':'';
      b.setAttribute('aria-expanded',open?'true':'false');
      var f=open ? m.querySelector('a,button') : b;
      if(f) f.focus();
    };
    b.addEventListener('click',function(){ setOpen(!m.hasAttribute('data-open')) });
    m.addEventListener('click',function(e){ if(e.target.closest('a')) setOpen(false) });
    addEventListener('keydown',function(e){
      if(!m.hasAttribute('data-open')) return;
      if(e.key==='Escape'){ e.preventDefault(); setOpen(false); return }
      if(e.key!=='Tab') return;
      var f=loop(), i=f.indexOf(document.activeElement);
      if(e.shiftKey && i<=0){ e.preventDefault(); f[f.length-1].focus() }
      else if(!e.shiftKey && i===f.length-1){ e.preventDefault(); f[0].focus() }
    });
  }
})();

/* ══ Daylight clock — one value everything else agrees on ══ */
(function(){
  var root=document.documentElement;
  var on=raf(function(){
    var p=progress();
    var e = p<0.18 ? p*0.28 : 0.05 + Math.pow((p-0.18)/0.82,0.78)*0.95;
    root.style.setProperty('--daylight',e.toFixed(4));
  });
  on(); addEventListener('scroll',on,{passive:true}); addEventListener('resize',on,{passive:true});
})();

/* ══ THE ROUTE ══════════════════════════════════════════
   A carriageway drawn in Canvas 2D with a real perspective
   projection. No library: a road is a ribbon around a spline,
   and projecting it by hand is a few lines of maths — which
   also means it starts instantly and costs nothing to ship. */
(function(){
  var cv=document.getElementById('route'); if(!cv||RM) return;
  if(innerWidth<1024) return;
  var ctx=cv.getContext('2d'); if(!ctx) return;
  var W=0,H=0,DPR=1;
  var stops=[];             // chapter positions along the page, 0..1
  var drive=0, target=0;    // eased camera position

  function size(){
    DPR=Math.min(devicePixelRatio||1,1.75);
    W=cv.clientWidth; H=cv.clientHeight;
    cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  function measure(){
    var secs=$$('[data-atmo]'), r=document.documentElement.scrollHeight-innerHeight;
    stops=secs.map(function(el){
      var b=el.getBoundingClientRect();
      return r>0 ? clamp((b.top+scrollY+b.height/2-innerHeight/2)/r,0,1) : 0;
    });
  }
  // The course: gentle S-bends so the camera sways without leaving the road.
  function curveX(t){ return Math.sin(t*Math.PI*2.1)*26 + Math.sin(t*Math.PI*0.7)*14 }

  // Project a point in road space (x lateral, z metres ahead) to screen.
  function project(x,z,camX,horizon){
    var d=z; if(d<1.2) return null;
    var f=520/d;                       // focal falloff
    return { x: W/2 + (x-camX)*f, y: horizon + (2.35*f), s:f };
  }

  var day=0;
  function draw(){
    var horizon=H*0.5;
    var camT=drive;
    var camX=curveX(camT);
    day = camT<0.18 ? camT*0.28 : 0.05+Math.pow((camT-0.18)/0.82,0.78)*0.95;
    day*=0.4;

    ctx.clearRect(0,0,W,H);

    // Ground: two bands meeting at the horizon, warming with the day
    var g=ctx.createLinearGradient(0,horizon-40,0,H);
    g.addColorStop(0,'rgba('+mix(18,150,day)+','+mix(23,142,day)+','+mix(30,130,day)+',0)');
    g.addColorStop(0.16,'rgba('+mix(20,150,day)+','+mix(25,142,day)+','+mix(32,130,day)+',.85)');
    g.addColorStop(1,'rgba('+mix(26,140,day)+','+mix(32,133,day)+','+mix(40,122,day)+',1)');
    ctx.fillStyle=g; ctx.fillRect(0,horizon-40,W,H-horizon+40);

    // Road ribbon
    var SEG=44, near=2.5, far=190;
    ctx.beginPath();
    var left=[],right=[];
    for(var i=0;i<=SEG;i++){
      var t=i/SEG, z=near+(far-near)*Math.pow(t,1.7);
      var tt=clamp(camT+z*0.0016,0,1);
      var cx=curveX(tt);
      var pl=project(cx-5.4,z,camX,horizon), pr=project(cx+5.4,z,camX,horizon);
      if(pl&&pr){ left.push(pl); right.push(pr) }
    }
    if(left.length<2) { requestAnimationFrame(loop); return }
    ctx.moveTo(left[0].x,left[0].y);
    for(var a=1;a<left.length;a++) ctx.lineTo(left[a].x,left[a].y);
    for(var b=right.length-1;b>=0;b--) ctx.lineTo(right[b].x,right[b].y);
    ctx.closePath();
    ctx.fillStyle='rgb('+mix(30,128,day)+','+mix(36,122,day)+','+mix(45,112,day)+')';
    ctx.fill();

    // Edge lines
    ctx.lineWidth=1.4; ctx.strokeStyle='rgba(244,242,237,'+(0.16+day*0.3)+')';
    stroke(left); stroke(right);

    // The signal filament down the centre, with a pulse running ahead
    var mid=[];
    for(var i2=0;i2<left.length;i2++) mid.push({x:(left[i2].x+right[i2].x)/2,y:left[i2].y,s:left[i2].s});
    var pulse=(performance.now()/1000*0.16)%1;
    for(var k=0;k<mid.length-1;k++){
      var f2=k/(mid.length-1);
      var glow=Math.max(0,1-Math.abs(f2-pulse)*7);
      ctx.beginPath(); ctx.moveTo(mid[k].x,mid[k].y); ctx.lineTo(mid[k+1].x,mid[k+1].y);
      ctx.lineWidth=Math.max(1.2,mid[k].s*0.075);
      ctx.strokeStyle='rgba(225,10,23,'+(0.5+glow*0.5)*(1-f2*0.55)+')';
      ctx.stroke();
      if(glow>0.05){ ctx.save(); ctx.globalCompositeOperation='lighter';
        ctx.lineWidth=Math.max(3,mid[k].s*0.2); ctx.strokeStyle='rgba(255,70,80,'+glow*0.32+')';
        ctx.beginPath(); ctx.moveTo(mid[k].x,mid[k].y); ctx.lineTo(mid[k+1].x,mid[k+1].y); ctx.stroke(); ctx.restore() }
    }

    // Chapter waypoints: a light post beside the road, lit as you approach
    for(var s=0;s<stops.length;s++){
      var dz=(stops[s]-camT)/0.0016;
      if(dz<3||dz>170) continue;
      var tt2=clamp(stops[s],0,1);
      var side=(s%2===0)?1:-1;
      var p=project(curveX(tt2)+side*7.4,dz,camX,horizon); if(!p) continue;
      var lit=clamp(1-Math.abs(stops[s]-camT)*13,0,1);
      var hgt=p.s*8.2;
      ctx.save(); ctx.globalCompositeOperation='lighter';
      var lg=ctx.createLinearGradient(p.x,p.y-hgt,p.x,p.y);
      lg.addColorStop(0,'rgba(225,10,23,0)');
      lg.addColorStop(1,'rgba(255,58,68,'+(0.2+lit*0.55)+')');
      ctx.fillStyle=lg; ctx.fillRect(p.x-p.s*0.06,p.y-hgt,Math.max(1.5,p.s*0.12),hgt);
      ctx.beginPath(); ctx.ellipse(p.x,p.y,Math.max(3,p.s*0.5),Math.max(1,p.s*0.16),0,0,6.284);
      ctx.strokeStyle='rgba(255,58,68,'+(0.3+lit*0.6)+')'; ctx.lineWidth=Math.max(1,p.s*0.03); ctx.stroke();
      ctx.restore();
    }

    // Horizon haze — the light the road is driving toward
    ctx.save(); ctx.globalCompositeOperation='lighter';
    var hz=ctx.createRadialGradient(W/2,horizon,0,W/2,horizon,W*0.45);
    hz.addColorStop(0,'rgba(255,'+Math.round(200+day*40)+','+Math.round(150+day*60)+','+(0.1+day*0.5)+')');
    hz.addColorStop(1,'rgba(255,200,150,0)');
    ctx.fillStyle=hz; ctx.fillRect(0,horizon-H*0.34,W,H*0.6); ctx.restore();
  }
  function stroke(pts){ ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
    for(var i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y); ctx.stroke() }
  function mix(a,b,t){ return Math.round(a+(b-a)*t) }

  var running=true, alive=true;
  function loop(){
    if(!alive) return;
    drive += (target-drive)*0.09;
    if(running) draw();
    requestAnimationFrame(loop);
  }
  function onScroll(){
    target=progress()*0.86;
    // Stop drawing where a daylight chapter covers the canvas completely.
    var covered=$$('.day').some(function(el){var r=el.getBoundingClientRect();return r.top<=0&&r.bottom>=innerHeight});
    running=!covered&&!document.hidden;
    cv.toggleAttribute('data-on',!covered);
  }
  size(); measure(); onScroll(); cv.setAttribute('data-on','');
  addEventListener('scroll',raf(onScroll),{passive:true});
  addEventListener('resize',raf(function(){size();measure();onScroll()}),{passive:true});
  document.addEventListener('visibilitychange',function(){running=!document.hidden&&running});
  setTimeout(measure,600); setTimeout(measure,2000);
  loop();
})();

/* ══ Chapter rail (Minimal Dock) ═══════════════════════ */
(function(){
  var rail=$('.rail'); if(!rail) return;
  var secs=$$('[data-atmo]');
  secs.forEach(function(el,i){
    var b=document.createElement('button');
    var h=el.querySelector('h1,h2');
    var name=(h?h.textContent:'Kapitel '+(i+1)).replace(/\\s+/g,' ').trim();
    b.type='button'; b.setAttribute('aria-label','Zu: '+name);
    b.innerHTML='<span>'+name.slice(0,34)+'</span>';
    b.addEventListener('click',function(){ el.scrollIntoView({behavior:RM?'auto':'smooth',block:'start'}) });
    rail.appendChild(b);
  });
  var btns=$$('button',rail);
  var on=raf(function(){
    var mid=scrollY+innerHeight*0.42;
    secs.forEach(function(el,i){
      var r=el.getBoundingClientRect(), top=r.top+scrollY;
      var near=mid>=top&&mid<=top+r.height;
      btns[i].toggleAttribute('data-near',near);
    });
  });
  on(); addEventListener('scroll',on,{passive:true}); addEventListener('resize',on,{passive:true});
})();

/* ══ Headlight cursor (Morphing Cursor) ════════════════ */
(function(){
  if(!FINE||RM) return;
  var glow=document.createElement('div'); glow.className='cursor'; glow.setAttribute('aria-hidden','true');
  var dot=document.createElement('div'); dot.className='cursor-dot'; dot.setAttribute('aria-hidden','true');
  document.body.appendChild(glow); document.body.appendChild(dot);
  var tx=innerWidth/2,ty=innerHeight/2,x=tx,y=ty,dx=tx,dy=ty;
  addEventListener('pointermove',function(e){
    tx=e.clientX; ty=e.clientY; glow.style.opacity='1'; dot.style.opacity='1';
    var t=e.target.closest('a,button,.opt,.tab,input');
    dot.toggleAttribute('data-hot',!!t);
  },{passive:true});
  document.addEventListener('pointerleave',function(){glow.style.opacity='0';dot.style.opacity='0'});
  (function tick(){
    x+=(tx-x)*0.13; y+=(ty-y)*0.13; dx+=(tx-dx)*0.32; dy+=(ty-dy)*0.32;
    glow.style.transform='translate3d('+x+'px,'+y+'px,0)';
    dot.style.transform='translate3d('+dx+'px,'+dy+'px,0)';
    requestAnimationFrame(tick);
  })();
})();

/* ══ Reveal: blocks, and short headings word by word ════ */
(function(){
  if(RM) return;
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){
      e.target.setAttribute(e.target.hasAttribute('data-rw')?'data-rw':'data-rv','go');
      io.unobserve(e.target);
    }});
  },{threshold:0.2});
  $$('.rv').forEach(function(el){ el.setAttribute('data-rv','armed'); io.observe(el) });
  $$('[data-rw]').forEach(function(el){
    var words=el.textContent.trim().split(/\\s+/);
    if(words.length>4) { el.removeAttribute('data-rw'); return }  // rationed on purpose
    el.innerHTML=words.map(function(w,i){return '<span class="word" style="--w:'+i+'"><i>'+w+'</i></span>'}).join(' ');
    el.setAttribute('data-rw','armed'); io.observe(el);
  });
  var o=$('.outlier');
  if(o){ var txt=o.getAttribute('data-text')||o.textContent;
    o.innerHTML=txt.split('').map(function(c,i){return '<i style="--g:'+i+'">'+(c===' '?'&nbsp;':c)+'</i>'}).join('');
    o.setAttribute('data-o','armed');
    (document.fonts?document.fonts.ready:Promise.resolve()).then(function(){
      setTimeout(function(){o.setAttribute('data-o','go')},80) });
  }
})();

/* ══ Spotlight over grouped cards ══════════════════════ */
(function(){
  if(!FINE) return;
  $$('[data-spot]').forEach(function(group){
    var cards=$$('.spot',group), px=0,py=0;
    var paint=raf(function(){
      cards.forEach(function(c){
        var r=c.getBoundingClientRect();
        var ox=Math.max(r.left-px,0,px-r.right), oy=Math.max(r.top-py,0,py-r.bottom);
        c.style.setProperty('--mx',(px-r.left)+'px'); c.style.setProperty('--my',(py-r.top)+'px');
        c.style.setProperty('--s',String(Math.max(0,1-Math.hypot(ox,oy)/260)));
      });
    });
    group.addEventListener('pointermove',function(e){px=e.clientX;py=e.clientY;paint()});
    group.addEventListener('pointerleave',function(){cards.forEach(function(c){c.style.setProperty('--s','0')})});
  });
})();

/* ══ Magnetic buttons ══════════════════════════════════ */
(function(){
  if(!FINE||RM) return;
  $$('[data-magnet]').forEach(function(el){
    el.addEventListener('pointermove',function(e){
      var r=el.getBoundingClientRect();
      var mx=clamp((e.clientX-(r.left+r.width/2))*0.26,-16,16);
      var my=clamp((e.clientY-(r.top+r.height/2))*0.26,-16,16);
      el.style.transform='translate('+mx+'px,'+my+'px)';
    });
    el.addEventListener('pointerleave',function(){el.style.transform=''});
  });
})();

/* ══ 3D tilt cards (Animated Profile Card) ═════════════ */
(function(){
  if(!FINE||RM) return;
  $$('.tilt').forEach(function(el){
    el.addEventListener('pointermove',function(e){
      var r=el.getBoundingClientRect();
      var rx=((e.clientY-r.top)/r.height-0.5)*-7, ry=((e.clientX-r.left)/r.width-0.5)*9;
      el.style.transform='perspective(900px) rotateX('+rx+'deg) rotateY('+ry+'deg)';
    });
    el.addEventListener('pointerleave',function(){el.style.transform=''});
  });
})();

/* ══ Loupe (View Magnifier) ════════════════════════════ */
(function(){
  if(!FINE||RM) return;
  $$('.loupe').forEach(function(fig){
    var img=$('img',fig), lens=$('.lens',fig); if(!img||!lens) return;
    lens.style.backgroundImage='url('+img.getAttribute('src')+')';
    fig.addEventListener('pointerenter',function(){lens.style.opacity='1'});
    fig.addEventListener('pointerleave',function(){lens.style.opacity='0'});
    fig.addEventListener('pointermove',function(e){
      var r=fig.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
      lens.style.transform='translate3d('+x+'px,'+y+'px,0)';
      lens.style.backgroundSize=(r.width*2.2)+'px '+(r.height*2.2)+'px';
      lens.style.backgroundPosition=((x/r.width)*100)+'% '+((y/r.height)*100)+'%';
    });
  });
})();

/* ══ Video: play only on screen, poster otherwise ══════ */
(function(){
  $$('video[data-src]').forEach(function(v){
    if(RM||navigator.connection&&navigator.connection.saveData) return;   // poster is enough
    var io=new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(e.isIntersecting){
          if(!v.src){ v.src=v.getAttribute('data-src') }
          var p=v.play(); if(p&&p.catch) p.catch(function(){});
        } else v.pause();
      });
    },{rootMargin:'60% 0px'});
    io.observe(v);
  });
})();

/* ══ Tabs with a sliding indicator (Animated Tabs) ═════ */
(function(){
  $$('[data-tabs]').forEach(function(wrap){
    var tabs=$$('.tab',wrap), ind=$('.ind',wrap);
    function select(id,focus){
      tabs.forEach(function(t){
        var on=t.dataset.tab===id;
        t.setAttribute('aria-selected',on?'true':'false'); t.tabIndex=on?0:-1;
        var panel=document.getElementById('panel-'+t.dataset.tab);
        if(panel) panel.hidden=!on;
        if(on&&focus) t.focus();
      });
      place();
    }
    function place(){
      var t=tabs.filter(function(x){return x.getAttribute('aria-selected')==='true'})[0];
      if(!t||!ind) return;
      var w=wrap.getBoundingClientRect(), r=t.getBoundingClientRect();
      ind.style.width=r.width+'px'; ind.style.height=r.height+'px';
      ind.style.transform='translate3d('+(r.left-w.left+wrap.scrollLeft)+'px,'+(r.top-w.top)+'px,0)';
      ind.style.opacity='1';
    }
    tabs.forEach(function(t){ t.addEventListener('click',function(){select(t.dataset.tab)}) });
    wrap.addEventListener('keydown',function(e){
      var i=tabs.findIndex(function(x){return x.getAttribute('aria-selected')==='true'});
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
        e.preventDefault();
        var n=(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
        select(tabs[n].dataset.tab,true);
      }
    });
    wrap.addEventListener('scroll',place,{passive:true});
    addEventListener('resize',place,{passive:true});
    select(tabs[0].dataset.tab); setTimeout(place,60);
  });
})();

/* ══ Carousel (Feature Carousel) ═══════════════════════ */
(function(){
  $$('[data-carousel]').forEach(function(el){
    var track=$('.carousel-track',el), nav=$('.carousel-nav',el);
    var n=track.children.length, i=0;
    for(var k=0;k<n;k++){
      var b=document.createElement('button'); b.type='button';
      b.setAttribute('aria-label','Situation '+(k+1));
      (function(k){b.addEventListener('click',function(){go(k)})})(k);
      nav.appendChild(b);
    }
    var dots=$$('button',nav);
    function go(k){ i=(k+n)%n; track.style.transform='translateX('+(-i*100)+'%)';
      dots.forEach(function(d,j){d.setAttribute('aria-current',j===i?'true':'false')}) }
    go(0);
    var timer=RM?0:setInterval(function(){go(i+1)},5200);
    el.addEventListener('pointerenter',function(){clearInterval(timer)});
  });
})();

/* ══ Ripple canvas behind the finder (Shader Animation) ══ */
(function(){
  var cv=$('.ripple'); if(!cv||RM) return;
  var ctx=cv.getContext('2d'); if(!ctx) return;
  var w=0,h=0,vis=false;
  function size(){ var d=Math.min(devicePixelRatio||1,1.5);
    w=cv.clientWidth; h=cv.clientHeight; cv.width=w*d; cv.height=h*d; ctx.setTransform(d,0,0,d,0,0) }
  new IntersectionObserver(function(e){vis=e[0].isIntersecting}).observe(cv);
  size(); addEventListener('resize',raf(size),{passive:true});
  (function tick(t){
    requestAnimationFrame(tick);
    if(!vis) return;
    ctx.clearRect(0,0,w,h);
    var cx=w*0.82, cy=h*0.3;
    for(var r=0;r<7;r++){
      var ph=(t/1000*0.14+r/7)%1;
      var rad=ph*Math.max(w,h)*0.8;
      ctx.beginPath(); ctx.arc(cx,cy,rad,0,6.284);
      ctx.strokeStyle='rgba(225,10,23,'+(1-ph)*0.16+')'; ctx.lineWidth=1.4; ctx.stroke();
    }
  })(0);
})();

/* ══ Sign-in flow background (docked to the cockpit) ═══ */
(function(){
  var cv=$('.signin canvas'); if(!cv||RM) return;
  var ctx=cv.getContext('2d'); if(!ctx) return;
  var w,h,pts=[],vis=false;
  function size(){ w=cv.clientWidth; h=cv.clientHeight; cv.width=w; cv.height=h;
    pts=[]; for(var i=0;i<26;i++) pts.push({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-.5)*.22,vy:(Math.random()-.5)*.22}) }
  new IntersectionObserver(function(e){vis=e[0].isIntersecting}).observe(cv);
  size(); addEventListener('resize',raf(size),{passive:true});
  (function tick(){
    requestAnimationFrame(tick); if(!vis||!w) return;
    ctx.clearRect(0,0,w,h);
    pts.forEach(function(p){ p.x+=p.vx; p.y+=p.vy;
      if(p.x<0||p.x>w)p.vx*=-1; if(p.y<0||p.y>h)p.vy*=-1 });
    for(var i=0;i<pts.length;i++) for(var j=i+1;j<pts.length;j++){
      var d=Math.hypot(pts[i].x-pts[j].x,pts[i].y-pts[j].y);
      if(d<92){ ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
        ctx.strokeStyle='rgba(225,10,23,'+(1-d/92)*0.3+')'; ctx.lineWidth=.7; ctx.stroke() }
    }
  })();
})();

/* ══ Guide beam drawn by scrolling ═════════════════════ */
(function(){
  var list=$('.beam'); if(!list) return;
  if(RM){ list.style.setProperty('--b','1'); $$('.dot',list).forEach(function(d){d.setAttribute('data-lit','')}); return }
  var dots=$$('.dot',list);
  var on=raf(function(){
    var r=list.getBoundingClientRect();
    if(r.bottom<-100||r.top>innerHeight+100) return;
    var p=clamp((innerHeight*0.78-r.top)/r.height,0,1);
    list.style.setProperty('--b',p.toFixed(4));
    dots.forEach(function(d){
      var y=d.getBoundingClientRect().top-r.top;
      d.toggleAttribute('data-lit', p*r.height>=y);
    });
  });
  on(); addEventListener('scroll',on,{passive:true}); addEventListener('resize',on,{passive:true});
})();

/* ══ Cockpit: the device tilts and the app scrolls with you ══
   (Container Scroll + Section With Mockup, in one piece) */
(function(){
  var wrap=$('.cockpit'); if(!wrap) return;
  var phone=$('.phone',wrap), inner=$('.phone-scroll',wrap), dots=$$('.scenes i',wrap);
  var ring=$('.ring',wrap), counters=$$('[data-count]',wrap);
  if(!phone||!inner) return;
  if(RM){ inner.style.transform=''; dots.forEach(function(d,i){d.toggleAttribute('data-on',i===0)}); return }
  var last=-1;
  var on=raf(function(){
    var r=wrap.getBoundingClientRect();
    var span=r.height-innerHeight;
    if(span<=0) return;
    var p=clamp(-r.top/span,0,1);
    // Device settles from a tilt as it enters, then holds
    var t=clamp(p*4,0,1);
    phone.style.transform='perspective(1100px) rotateX('+(14-14*t)+'deg) rotateY('+(-10+10*t)+'deg) scale('+(0.9+0.1*t)+')';
    // App content scrolls in step with the page
    var max=inner.scrollHeight-inner.parentElement.clientHeight;
    inner.style.transform='translateY('+(-max*p)+'px)';
    var scene=Math.min(dots.length-1,Math.floor(p*dots.length));
    if(scene!==last){ last=scene; dots.forEach(function(d,i){d.toggleAttribute('data-on',i===scene)}) }
    if(ring) ring.style.setProperty('--p',String(Math.round(clamp((p-0.35)/0.35,0,1)*73)));
    counters.forEach(function(c){
      var to=+c.dataset.count, from=+(c.dataset.from||0);
      var w=clamp((p-0.15)/0.3,0,1);
      c.textContent=String(Math.round(from+(to-from)*w));
    });
  });
  on(); addEventListener('scroll',on,{passive:true}); addEventListener('resize',on,{passive:true});
})();

/* ══ LICENCE FINDER ════════════════════════════════════ */
(function(){
  var root=$('#finder'); if(!root||!window.KREBS) return;
  var Q=KREBS.finder.questions, step=0, answers={}, done=false;
  var bar=$('.finder-bar i',root), body=$('[data-finder-body]',root);

  function visible(){ return Q.filter(function(q){ return !(q.id==='gear'&&answers.vehicle!=='auto') }) }
  function render(){
    var qs=visible();
    bar.style.width=Math.max(4,(done?1:step/qs.length)*100)+'%';
    if(!done){
      var q=qs[step];
      body.innerHTML='<div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem">'+
        '<h3 style="font-size:1.3rem">'+esc(q.question)+'</h3>'+
        '<span class="tabular" style="font-size:.75rem;font-weight:700;color:var(--chalk-faint);flex:none">'+(step+1)+' / '+qs.length+'</span></div>'+
        (q.hint?'<p style="margin-top:.5rem;font-size:.88rem;color:var(--chalk-dim)">'+esc(q.hint)+'</p>':'')+
        '<div class="grid g2" data-spot style="margin-top:1.3rem">'+
        q.options.map(function(o){return '<button class="opt spot" type="button" data-v="'+esc(o.value)+'">'+
          '<em></em><span><b>'+esc(o.label)+'</b>'+(o.description?'<small>'+esc(o.description)+'</small>':'')+'</span></button>'}).join('')+
        '</div>'+
        (step>0?'<button type="button" data-back style="margin-top:1.3rem;background:none;border:0;cursor:pointer;font-weight:650;font-size:.88rem;color:var(--chalk-dim)">← Eine Frage zurück</button>':'');
      $$('.opt',body).forEach(function(b){ b.addEventListener('click',function(){
        answers[q.id]=b.dataset.v;
        if(step+1>=visible().length){done=true} else {step++}
        render();
        if(done) body.focus();
      })});
      var back=$('[data-back]',body); if(back) back.addEventListener('click',function(){step--;render()});
    } else {
      var res=KREBS.finder.recommend(answers), top=res[0];
      if(!top){ body.innerHTML='<p>Dazu passt keine Standardklasse — sprich uns direkt an.</p>'; return }
      body.innerHTML='<p class="eyebrow" style="color:var(--signal-400)">Unsere Empfehlung</p>'+
        '<h3 style="font-size:clamp(1.8rem,3.4vw,2.5rem);margin-top:.8rem">'+esc(top.name)+'</h3>'+
        '<p style="margin-top:.8rem;color:var(--chalk-soft);max-width:52ch">'+esc(top.summary)+'</p>'+
        '<div class="grid g2" style="margin-top:1.3rem">'+
          '<div class="card" style="padding:1rem"><div class="eyebrow" style="font-size:.62rem">Mindestalter</div><b style="display:block;margin-top:.4rem">'+esc(top.minAge||'Auf Anfrage')+'</b></div>'+
          '<div class="card" style="padding:1rem"><div class="eyebrow" style="font-size:.62rem">Voraussetzungen</div><b style="display:block;margin-top:.4rem;font-weight:500;font-size:.9rem">'+esc(top.prerequisites.slice(0,2).join(' · ')||'Keine besonderen')+'</b></div>'+
        '</div>'+
        (top.reasons.length?'<ul style="margin-top:1.3rem;list-style:none;display:grid;gap:.5rem">'+top.reasons.map(function(r){
          return '<li style="display:flex;gap:.6rem;font-size:.9rem;color:var(--chalk-soft)"><span style="flex:none;margin-top:.55rem;width:.75rem;height:.2rem;border-radius:1px;background:var(--signal)"></span>'+esc(r)+'</li>'}).join('')+'</ul>':'')+
        '<div style="display:flex;flex-wrap:wrap;gap:.7rem;margin-top:1.7rem">'+
          '<a class="btn btn-primary shine" href="'+top.href+'">'+esc(top.name)+' ansehen</a>'+
          '<a class="btn btn-ghost" href="kontakt.html?bezug='+esc(top.slug)+'">Beratung dazu anfragen</a>'+
          '<button class="btn btn-quiet" type="button" data-restart>Neu starten</button>'+
        '</div>';
      var rs=$('[data-restart]',body);
      if(rs) rs.addEventListener('click',function(){answers={};step=0;done=false;render()});
    }
  }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]}) }
  render();
})();

/* ══ PRICE COMPARISON ══════════════════════════════════
   The engine from src/lib/pricing.ts, in plain JS: money is
   kept in integer cents so no total is ever off by a rounding
   cent, and German decimal notation is parsed properly —
   "2.000" is two thousand, "2,00" is two. */
(function(){
  var blocks=$$('[data-calc]'); if(!blocks.length||!window.KREBS) return;
  var fmt=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
  function money(c){ return fmt.format(c/100) }
  function parse(v){
    v=String(v).trim(); if(!v) return null;
    v=v.replace(/[^0-9.,-]/g,''); if(!v) return null;
    var lc=v.lastIndexOf(','), ld=v.lastIndexOf('.');
    if(lc>-1&&ld>-1){ v = lc>ld ? v.replace(/\./g,'').replace(',','.') : v.replace(/,/g,'') }
    else if(lc>-1){ v = (v.length-lc-1)===3 ? v.replace(/,/g,'') : v.replace(',','.') }
    else if(ld>-1&&(v.length-ld-1)===3){ v=v.replace(/\./g,'') }
    var n=parseFloat(v);
    return isFinite(n) ? Math.round(n*100) : null;
  }
  blocks.forEach(function(block){
    var slug=block.dataset.calc;
    var variant=KREBS.prices.variants.filter(function(v){return v.slug===slug})[0];
    if(!variant) return;
    var panel=block.parentElement;
    var out=$('[data-verdict]',panel);
    function id(pre,r){ return pre+'-'+slug+'-'+r.id }
    function recalc(){
      var a=0,b=0,anyA=false,anyB=false;
      variant.rows.forEach(function(r){
        var q=Math.max(0,parseInt($('#'+id('q',r),panel).value,10)||0);
        var pa=parse($('#'+id('a',r),panel).value), pb=parse($('#'+id('b',r),panel).value);
        var sa=pa===null?null:pa*q, sb=pb===null?null:pb*q;
        if(sa!==null){a+=sa;anyA=true} if(sb!==null){b+=sb;anyB=true}
        $('#'+id('sa',r),panel).textContent = sa===null?'—':money(sa);
        $('#'+id('sb',r),panel).textContent = sb===null?'—':money(sb);
        var d=$('#'+id('d',r),panel);
        if(sa!==null&&sb!==null){
          var diff=sa-sb;
          d.textContent = diff===0?'gleich':(diff>0?'+ ':'− ')+money(Math.abs(diff));
          d.style.color = diff>0?'var(--signal)':(diff<0?'var(--ok)':'var(--chalk-dim)');
        } else { d.textContent='—'; d.style.color='' }
      });
      $('[data-total-a]',panel).textContent = anyA?money(a):'—';
      $('[data-total-b]',panel).textContent = anyB?money(b):'—';
      if(anyA&&anyB){
        var diff=a-b; out.hidden=false;
        out.innerHTML = diff===0
          ? '<b>Gleichstand.</b> Beide Angebote kosten bei diesen Mengen exakt dasselbe — entscheide nach Terminen, Fahrzeugen und Bauchgefühl.'
          : '<b>Differenz: '+money(Math.abs(diff))+'</b> — '+(diff>0?'das Vergleichsangebot':'dein Angebot')+' ist bei <em>denselben Mengen</em> günstiger. Ein niedriger Grundbetrag sagt wenig, wenn die Fahrstunden teurer sind.';
      } else out.hidden=true;
    }
    $$('input',panel).forEach(function(i){ i.addEventListener('input',recalc) });
    recalc();
  });
})();

/* ══ Contact form: a real mailto, never a demo toast ════ */
(function(){
  var f=$('#anfrage'); if(!f) return;
  var params=new URLSearchParams(location.search);
  var bezug=(params.get('bezug')||'').replace(/[^a-z0-9-]/gi,'');
  if(bezug&&window.KREBS){
    var m=KREBS.referenceLabel(bezug);
    if(m){ var box=$('[data-bezug]',f); box.hidden=false;
      box.innerHTML='Deine Anfrage bezieht sich auf <b>'+m.label+'</b>';
      var sel=$('#thema',f); if(sel&&m.topic) sel.value=m.topic;
      $('#ref',f).value=bezug; }
  }
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var d=new FormData(f), lines=[];
    ['name','email','phone','standort','thema','nachricht'].forEach(function(k){
      var v=(d.get(k)||'').toString().trim(); if(v) lines.push(labelFor(k)+': '+v);
    });
    if($('#ref',f).value) lines.push('Bezug: '+$('#ref',f).value);
    var body=encodeURIComponent(lines.join('\\n'));
    var subj=encodeURIComponent('Anfrage über die Website — '+(d.get('thema')||'Allgemein'));
    location.href='mailto:'+f.dataset.to+'?subject='+subj+'&body='+body;
    $('[data-sent]',f).hidden=false;
  });
  function labelFor(k){ return {name:'Name',email:'E-Mail',phone:'Telefon',standort:'Standort',thema:'Thema',nachricht:'Nachricht'}[k]||k }
})();

})();
`
