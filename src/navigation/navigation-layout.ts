export interface NavigationWindow { windowWidth: number; statusBarHeight?: number; safeArea?: {top:number} }
export interface MenuBounds { left:number; top:number; width:number; height:number; bottom:number }
/** All coordinates are screen px, as returned by the mini-program window/menu APIs. */
export function navigationLayout(window: NavigationWindow, menu?: MenuBounds) {
  const width = Math.max(1,window.windowWidth || 375)
  const status = Math.max(0,window.statusBarHeight ?? window.safeArea?.top ?? 24)
  const gutter = width < 360 ? 12 : 16
  const valid = menu && menu.left>0 && menu.left<width && menu.height>0 && menu.top>=status && menu.bottom>=menu.top+menu.height-1
  const menuLeft = valid ? menu.left : Math.max(0,width-104)
  const barHeight = valid ? Math.max(44,(menu.top-status)*2+menu.height) : 44
  const shellWidth = Math.min(540,width)
  const contentRight = (width+shellWidth)/2-gutter
  const reserve = Math.max(0,contentRight-menuLeft+10)
  const contentWidth = shellWidth-gutter*2
  return {status,barHeight,gutter,reserve,inlineTitleWidth:Math.max(0,contentWidth-reserve-44-44-16)}
}
export function moveEditBelow(layout: ReturnType<typeof navigationLayout>, from: string, to: string) {
  // Conservative text budget; long Chinese names wrap in the existing title instead of touching the capsule.
  return (Array.from(from+to).length*18+28) > layout.inlineTitleWidth
}
