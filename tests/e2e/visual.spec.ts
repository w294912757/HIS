import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
]) {
  test(`视觉布局 ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.request.post('/__clinic_api', { data: { method: 'test:reset' } })
    await page.request.post('/__clinic_api', { data: { method: 'records:create', args: { input: { visitDate: '2026-09-15', name: '视觉测试患者', gender: '女', ageRaw: '2岁10个月', diagnosis: '接触性皮炎复诊', clinicalManifestation: '面部红斑伴轻微瘙痒', treatment: '外用治疗并注意防晒，七日后复查', remark: '既往无药物过敏史', feeRaw: '295' } } } })
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByText('视觉测试患者')).toBeVisible()
    await expect(page.getByText('共 1 张病历', { exact: true })).toBeVisible()
    await expect(page.locator('.page-heading')).toHaveCount(0)
    const overflow = await page.evaluate(() => ({ horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth, vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight }))
    expect(overflow.horizontal).toBe(0)
    await page.screenshot({ path: testInfo.outputPath(`layout-${viewport.width}x${viewport.height}.png`), fullPage: true })
  })
}
