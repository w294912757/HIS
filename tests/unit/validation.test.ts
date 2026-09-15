import { describe, expect, it } from 'vitest'
import { normalizeInput, validateInput } from '../../src/main/db/repository'

const valid = {
  visitDate: '2026-09-15', name: ' 张三 ', gender: '男', ageRaw: '2岁10个月',
  diagnosis: null, clinicalManifestation: null, treatment: null, remark: null, feeRaw: '100-80'
}

describe('病历校验', () => {
  it('保留年龄和费用原始表达并清理首尾空白', () => {
    const result = normalizeInput(valid)
    expect(result.name).toBe('张三')
    expect(result.ageRaw).toBe('2岁10个月')
    expect(result.feeRaw).toBe('100-80')
  })

  it('拒绝空姓名和错误日期', () => {
    expect(() => validateInput({ ...valid, name: '' })).toThrow('姓名不能为空')
    expect(() => validateInput({ ...valid, visitDate: '2026/09/15' })).toThrow('日期必须使用')
    expect(() => validateInput({ ...valid, visitDate: '2026-02-30' })).toThrow('有效的日历日期')
    expect(() => validateInput({ ...valid, name: '长'.repeat(101) })).toThrow('姓名不能超过')
  })
})
