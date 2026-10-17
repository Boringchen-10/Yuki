import { useLayoutEffect, useRef } from "react";

/**
 * Match the information column while retaining the loaded image's own aspect ratio.
 * `cap` pins the width for layouts where comic and light novel covers must read the
 * same size even when one page has a much taller info column.
 */
export function useDetailPosterSize(cap?: number) {
  const body = useRef<HTMLElement>(null), poster = useRef<HTMLDivElement>(null), info = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container=body.current, cover=poster.current, details=info.current;
    if(!container||!cover||!details)return;
    let frame=0;
    const measure=()=>{
      frame=0;
      const image=cover.querySelector("img");
      const ready=!!image?.naturalWidth&&!!image.naturalHeight;
      const ratio=ready?image.naturalWidth/image.naturalHeight:2/3;
      const gap=parseFloat(getComputedStyle(container).columnGap)||18;
      const available=container.getBoundingClientRect().width;
      const maxWidth=Math.max(0,available-gap-Math.min(140,available*.44));
      const width=Math.min(details.getBoundingClientRect().height*ratio,maxWidth,cap??Infinity);
      if(width>0&&Math.abs((parseFloat(container.style.getPropertyValue("--detail-poster-width"))||0)-width)>.5)container.style.setProperty("--detail-poster-width",`${width}px`);
      cover.style.aspectRatio=String(ratio);
      cover.dataset.imageReady=String(ready);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    const resized=new ResizeObserver(schedule);resized.observe(container);resized.observe(details);
    const changed=new MutationObserver(schedule);changed.observe(cover,{childList:true,subtree:true,attributes:true,attributeFilter:["src"]});
    cover.addEventListener("load",schedule,true);measure();
    return()=>{cancelAnimationFrame(frame);resized.disconnect();changed.disconnect();cover.removeEventListener("load",schedule,true);};
  },[]);
  return {body,poster,info};
}
