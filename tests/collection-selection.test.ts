import {describe,it,expect} from 'vitest'
import {stationsForCollection} from '../src/maintenance/collection-selection'
import {fuzhouDataset} from '../src/data/fuzhou'
describe('line-first collection selection',()=>{
  it('limits stations to the chosen line in operating order without mixing duplicate names',()=>{
    const stations=stationsForCollection(fuzhouDataset,'fz-l1')
    expect(stations[0].name).toBe('象峰')
    expect(stations.at(-1)!.name).toBe('三江口')
    expect(stations.some(s=>s.id==='fz-三叉街-滨海快线')).toBe(false)
    expect(stationsForCollection(fuzhouDataset,'fz-f1').some(s=>s.id==='fz-三叉街-滨海快线')).toBe(true)
    expect(stationsForCollection(fuzhouDataset,'missing')).toEqual([])
  })
})
