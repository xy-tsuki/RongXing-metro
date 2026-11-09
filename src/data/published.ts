import { shallowRef, ref } from 'vue'
import { maintenanceRequest } from '../maintenance/api'
import { DataSync } from './data-sync'
import { readPublishedCache, writePublishedCache } from './published-cache'
import { type DataSnapshot } from './release-contract'
import { setServiceCalendar } from '../navigation/service-calendar'

export const publishedData = shallowRef<DataSnapshot | null>(null)
export const dataUpdateStatus = ref('使用随包数据')
let sync: DataSync | undefined
export function refreshPublishedData(force = false) {
  if (!sync) sync = new DataSync({
    request: maintenanceRequest,
    read: () => readPublishedCache({get:key=>uni.getStorageSync(key),set:(key,value)=>uni.setStorageSync(key,value)}),
    write: value => writePublishedCache({get:key=>uni.getStorageSync(key),set:(key,item)=>uni.setStorageSync(key,item)},value),
    changed: value => { setServiceCalendar(value.calendar); publishedData.value = value },
    status: value => { dataUpdateStatus.value = value }
  })
  return sync.refresh(force)
}
