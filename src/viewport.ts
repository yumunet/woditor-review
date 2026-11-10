export function viewportBox(height:number,top:number,scale:number,fallbackHeight:number) {
  return scale>1.01 || !Number.isFinite(height) || height<=0 ? {height:fallbackHeight,top:0} : {height,top:Math.max(0,top)};
}
export function installViewport(root:HTMLElement,changed:()=>void) {
  let frame=0;
  const update=()=>{
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      const viewport=window.visualViewport;
      const box=viewportBox(viewport?.height??innerHeight,viewport?.offsetTop??0,viewport?.scale??1,innerHeight);
      root.style.setProperty('--app-height',`${box.height}px`);root.style.setProperty('--app-top',`${box.top}px`);changed();
    });
  };
  window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);
  window.addEventListener('resize',update);update();
}
