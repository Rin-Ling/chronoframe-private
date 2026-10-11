<script lang="ts" setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import type { MapInstance } from '~~/shared/types/map'
import { gcj02ToWgs84, transformCoordinate } from '~/utils/coordinate-transform'

const props = withDefaults(
  defineProps<{
    modelValue?: { latitude: number; longitude: number } | null
    zoom?: number
    class?: string
  }>(),
  {
    modelValue: null,
    zoom: 4,
    class: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [{ latitude: number; longitude: number } | null]
  pick: [{ latitude: number; longitude: number }]
}>()

const mapInstance = ref<MapInstance | null>(null)
const markerCoordinates = ref<[number, number] | null>(null)
const searchKeyword = ref('')
const searchTips = ref<any[]>([])
const isSearching = ref(false)
const { locale } = useI18n({ useScope: 'global' })

const mapConfig = computed(() => {
  const config = getSetting('map')
  return typeof config === 'object' && config ? config : {}
})

const provider = computed(() => mapConfig.value.provider || 'maplibre')

let clickHandler: ((event: any) => void) | null = null
let autocomplete: any
let placeSearch: any
let autocompleteReady: Promise<void> | undefined
let searchRequestId = 0

const searchPlaceholder = computed(() =>
  locale.value.startsWith('zh') ? '搜索地区或地点' : 'Search area or place',
)
const moreResultsLabel = computed(() =>
  locale.value.startsWith('zh') ? '查看更多搜索结果' : 'View more results',
)

const tipDescription = (tip: any) =>
  [tip?.district, tip?.address, tip?.type].filter(Boolean).join(' · ')

const syncFromProps = (value: { latitude: number; longitude: number } | null) => {
  if (value) {
    const [lng, lat] = transformCoordinate(
      value.longitude,
      value.latitude,
      provider.value,
    )
    markerCoordinates.value = [lng, lat]
    if (mapInstance.value) {
      const map: any = mapInstance.value
      const zoom = Math.max(props.zoom ?? 4, 4)
      if (typeof map.setZoomAndCenter === 'function') {
        map.setZoomAndCenter(zoom, markerCoordinates.value, true, 0)
      } else if (typeof map.flyTo === 'function') {
        map.flyTo?.({
          center: markerCoordinates.value,
          zoom,
          essential: true,
        })
      } else {
        map.setCenter?.(markerCoordinates.value)
        map.setZoom?.(zoom)
      }
    }
  } else {
    markerCoordinates.value = null
  }
}

watch(
  () => props.modelValue,
  (value) => {
    syncFromProps(value ?? null)
  },
  { immediate: true },
)

const updateValue = (
  latitude: number,
  longitude: number,
  shouldEmitPick = true,
) => {
  markerCoordinates.value = [longitude, latitude]

  let wgsLatitude = latitude
  let wgsLongitude = longitude
  if (provider.value === 'amap') {
    const [lng, lat] = gcj02ToWgs84(longitude, latitude)
    wgsLatitude = lat
    wgsLongitude = lng
  }

  emit('update:modelValue', { latitude: wgsLatitude, longitude: wgsLongitude })
  if (shouldEmitPick) {
    emit('pick', { latitude: wgsLatitude, longitude: wgsLongitude })
  }
}

const handleMapClick = (event: any) => {
  const point =
    event?.lngLat ||
    event?.lnglat ||
    event?.latlng ||
    (Array.isArray(event) ? { lng: event[0], lat: event[1] } : null)
  if (!point) {
    return
  }

  const latitude =
    typeof point.lat === 'number'
      ? point.lat
      : typeof point.getLat === 'function'
        ? point.getLat()
        : point.latitude ?? point[1]
  const longitude =
    typeof point.lng === 'number'
      ? point.lng
      : typeof point.getLng === 'function'
        ? point.getLng()
        : point.longitude ?? point[0]
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return
  }
  updateValue(latitude, longitude)
}

const onMapLoad = (map: MapInstance) => {
  mapInstance.value = map

  if (markerCoordinates.value) {
    const anyMap: any = map
    anyMap.setCenter?.(markerCoordinates.value)
    anyMap.setZoom?.(Math.max(props.zoom ?? 4, 4))
  }

  const anyMap: any = map
  if (typeof anyMap.on === 'function') {
    clickHandler = (event: any) => handleMapClick(event)
    anyMap.on('click', clickHandler)
  }

  if (provider.value === 'amap' && window.AMap?.plugin) {
    autocompleteReady = new Promise((resolve) => {
      window.AMap.plugin(['AMap.AutoComplete', 'AMap.PlaceSearch'], () => {
        autocomplete = new window.AMap.AutoComplete({ city: '全国' })
        placeSearch = new window.AMap.PlaceSearch({ city: '全国', pageSize: 8 })
        resolve()
        if (searchKeyword.value.trim()) searchPlaces()
      })
    })
  }
}

const searchPlaces = async () => {
  searchTips.value = []
  const keyword = searchKeyword.value.trim()
  if (provider.value !== 'amap' || !keyword) return

  const requestId = ++searchRequestId
  isSearching.value = true
  try {
    const result = await $fetch<{ tips?: any[] }>('/api/location/search', {
      query: { keywords: keyword },
    })
    if (requestId !== searchRequestId) return
    if (result.tips?.length) {
      searchTips.value = result.tips
      isSearching.value = false
      return
    }
  } catch {
    // Fall back to the browser plugin when the server search is unavailable.
  }

  if (autocompleteReady) await autocompleteReady
  if (!autocomplete) {
    isSearching.value = false
    return
  }

  autocomplete.search(keyword, (status: string, result: any) => {
    if (requestId !== searchRequestId) return
    const tips = status === 'complete' ? (result?.tips ?? []) : []
    if (tips.length) {
      searchTips.value = tips.slice(0, 8)
      isSearching.value = false
      return
    }

    placeSearch?.search(keyword, (placeStatus: string, placeResult: any) => {
      isSearching.value = false
      if (placeStatus !== 'complete') return
      searchTips.value = (placeResult?.poiList?.pois ?? []).slice(0, 8)
    })
  })
}

const selectSearchTip = (tip: any) => {
  const location = tip?.location
  const coordinates =
    typeof location === 'string'
      ? location.split(',').map(Number)
      : undefined
  const longitude =
    typeof location?.getLng === 'function'
      ? location.getLng()
      : typeof location?.lng === 'number'
        ? location.lng
        : coordinates?.[0]
  const latitude =
    typeof location?.getLat === 'function'
      ? location.getLat()
      : typeof location?.lat === 'number'
        ? location.lat
        : coordinates?.[1]
  if (typeof longitude !== 'number' || typeof latitude !== 'number') return

  searchKeyword.value = tip.name || tip.address || ''
  searchTips.value = []
  updateValue(latitude, longitude)
  const anyMap: any = mapInstance.value
  anyMap?.setZoomAndCenter?.(Math.max(props.zoom ?? 4, 15), [longitude, latitude], true, 0)
}

onBeforeUnmount(() => {
  if (mapInstance.value && clickHandler) {
    const anyMap: any = mapInstance.value
    if (typeof anyMap.off === 'function') {
      anyMap.off('click', clickHandler)
    }
  }
  autocomplete = undefined
})
</script>

<template>
  <div :class="['relative w-full h-64 rounded-xl overflow-hidden', $props.class]">
    <div
      v-if="provider === 'amap'"
      class="absolute inset-x-3 top-3 z-10"
    >
      <form
        class="flex gap-2"
        @submit.prevent="searchPlaces"
      >
        <input
          v-model="searchKeyword"
          type="search"
          :placeholder="searchPlaceholder"
          class="min-w-0 flex-1 rounded-lg border border-neutral-200/80 bg-white/95 px-3 py-2 text-sm text-neutral-900 shadow-lg outline-none ring-primary/40 placeholder:text-neutral-400 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-100"
          @input="searchPlaces"
        />
        <button
          type="submit"
          aria-label="search"
          class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-white shadow-lg disabled:opacity-50"
          :disabled="isSearching || !searchKeyword.trim()"
        >
          <Icon v-if="!isSearching" name="lucide:search" class="size-5" />
          <span v-else class="text-xs">...</span>
        </button>
      </form>
      <div
        v-if="searchTips.length"
        class="mt-1 overflow-hidden rounded-lg border border-neutral-200/80 bg-white/95 shadow-lg dark:border-neutral-700 dark:bg-neutral-900/95"
      >
        <button
          v-for="tip in searchTips"
          :key="`${tip.id || tip.name}-${tip.address || ''}`"
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          @click="selectSearchTip(tip)"
        >
          <Icon
            :name="tip?.type ? 'lucide:search' : 'lucide:map-pin'"
            class="size-5 shrink-0 text-neutral-900 dark:text-neutral-100"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-base text-neutral-900 dark:text-neutral-100">{{ tip.name }}</span>
            <span v-if="tipDescription(tip)" class="block truncate text-sm text-neutral-500">{{ tipDescription(tip) }}</span>
          </span>
          <Icon name="lucide:corner-up-right" class="size-5 shrink-0 text-neutral-900 dark:text-neutral-100" />
        </button>
        <button
          type="button"
          class="w-full border-t border-neutral-100 px-3 py-2.5 text-center text-sm text-neutral-500 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800"
          @click="searchPlaces"
        >
          {{ moreResultsLabel }}
        </button>
      </div>
    </div>
    <MapProvider
      class="w-full h-full"
      :map-id="'photo-location-picker'"
      :center="markerCoordinates ?? undefined"
      :zoom="markerCoordinates ? Math.max($props.zoom ?? 4, 4) : $props.zoom ?? 2"
      :interactive="true"
      :language="locale"
      @load="onMapLoad"
    >
      <MapProviderMarker
        v-if="markerCoordinates"
        :lnglat="markerCoordinates"
      >
        <template #marker>
          <div class="relative">
            <div class="absolute inset-0 animate-ping rounded-full bg-primary/40" />
            <div class="relative size-4 rounded-full bg-primary border-2 border-white shadow" />
          </div>
        </template>
      </MapProviderMarker>
    </MapProvider>

    <div
      v-if="!markerCoordinates"
      class="absolute inset-0 pointer-events-none flex items-center justify-center text-sm text-neutral-600 dark:text-neutral-400"
    >
      <slot name="empty" />
    </div>
  </div>
</template>
