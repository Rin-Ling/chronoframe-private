import { settingsManager } from '~~/server/services/settings/settingsManager'

export default defineEventHandler(async (event) => {
  await requireUserSession(event)

  const { keywords, city } = getQuery(event)
  const keyword = String(keywords || '').trim()
  if (!keyword) return { tips: [] }

  const key =
    (await settingsManager.get<string>('map', 'amap.key')) ||
    (await settingsManager.get<string>('location', 'amap.key'))
  if (!key) return { tips: [] }

  const params = new URLSearchParams({
    key,
    keywords: keyword,
    datatype: 'all',
    city: String(city || '全国'),
    output: 'json',
  })
  const result = await $fetch<{ status?: string; tips?: any[] }>(
    `https://restapi.amap.com/v3/assistant/inputtips?${params.toString()}`,
  )

  return {
    tips: result.status === '1' ? (result.tips || []).slice(0, 10) : [],
  }
})
