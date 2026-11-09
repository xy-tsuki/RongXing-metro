import { validateUpdate, type Catalog, type Update } from './catalog'

/** New public collection rules only; workbook/history validation remains backward compatible. */
export function validatePublicUpdate(state: Catalog, update: Update): string[] {
  const errors = validateUpdate(state, update)
  if (errors.length) return errors
  if (update.entity === 'facilities') {
    if (!['楼梯', '电梯'].includes(update.values.类型)) errors.push('新投稿设施类型仅支持楼梯或电梯；扶梯请作为楼梯的附属信息采集')
    if (update.values.类型 === '电梯' && Object.prototype.hasOwnProperty.call(update.values, '上行扶梯')) errors.push('电梯投稿不能包含上行扶梯属性，请移除该字段')
  }
  if (update.entity === 'rows' && Object.prototype.hasOwnProperty.call(update.values, '电梯对应车厢车门') && Object.keys(update.values).some(key => /^\d是否有上行扶梯$/.test(key))) errors.push('电梯投稿不能包含楼梯上行扶梯属性，请分开采集')
  return errors
}
