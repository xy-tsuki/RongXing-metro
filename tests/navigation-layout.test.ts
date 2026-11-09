import {describe,it,expect} from 'vitest'
import {navigationLayout,moveEditBelow} from '../src/navigation/navigation-layout'
describe('mini-program header safe geometry',()=>{
  it.each([[320,20],[390,59],[430,44]])('keeps content left of the capsule on %ipx screens', (width,status)=>{
    const menu={left:width-100,top:status+6,width:88,height:32,bottom:status+38}
    const layout=navigationLayout({windowWidth:width,statusBarHeight:status},menu)
    expect(layout.status).toBe(status);expect(layout.barHeight).toBe(44)
    expect(width-layout.gutter-layout.reserve).toBeLessThanOrEqual(menu.left-10)
    expect(moveEditBelow(layout,'福州火车站','福州火车南站')).toBe(true)
  })
  it('uses safe-area information and reserves a fallback capsule region for invalid APIs',()=>{
    const layout=navigationLayout({windowWidth:375,safeArea:{top:44}},{left:0,top:0,width:0,height:0,bottom:0})
    expect(layout.status).toBe(44);expect(layout.reserve).toBeGreaterThan(80)
    expect(layout.barHeight).toBe(44)
  })
  it('does not unnecessarily reserve the screen edge when the page is centered on a tablet',()=>{
    const layout=navigationLayout({windowWidth:1024,statusBarHeight:24},{left:924,top:30,width:88,height:32,bottom:62})
    expect(layout.reserve).toBe(0)
    expect(moveEditBelow(layout,'南门兜','机场')).toBe(false)
  })
})
