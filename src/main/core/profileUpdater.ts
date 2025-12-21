import { addProfileItem, getCurrentProfileItem, getProfileConfig } from '../config'

const intervalPool: Record<string, NodeJS.Timeout> = {}
const USER_SUBSCRIPTION_ID = 'user-subscription-meta'
const EMPTY_SUBSCRIPTION_URL = 'https://example.com/empty-subscription'
const LOADING_SUBSCRIPTION_URL = 'https://example.com/loading-subscription'

export async function initProfileUpdater(): Promise<void> {
  const { items, current } = await getProfileConfig()
  const currentItem = await getCurrentProfileItem()
  
  for (const item of items.filter((i) => i.id !== current)) {
    if (item.type === 'remote' && item.interval) {
      // 跳过用户订阅占位URL（避免拉取无效订阅）
      if (
        item.id === USER_SUBSCRIPTION_ID &&
        (item.url === EMPTY_SUBSCRIPTION_URL || item.url === LOADING_SUBSCRIPTION_URL)
      ) {
        continue
      }
      
      intervalPool[item.id] = setTimeout(
        async () => {
          try {
            await addProfileItem(item)
          } catch (e) {
            /* ignore */
          }
        },
        item.interval * 60 * 1000
      )
      try {
        await addProfileItem(item)
      } catch (e) {
        /* ignore */
      }
    }
  }
  if (currentItem?.type === 'remote' && currentItem.interval) {
    // 跳过用户订阅占位URL（避免拉取无效订阅）
    if (
      currentItem.id === USER_SUBSCRIPTION_ID &&
      (currentItem.url === EMPTY_SUBSCRIPTION_URL || currentItem.url === LOADING_SUBSCRIPTION_URL)
    ) {
      return
    }
    
    intervalPool[currentItem.id] = setTimeout(
      async () => {
        try {
          await addProfileItem(currentItem)
        } catch (e) {
          /* ignore */
        }
      },
      currentItem.interval * 60 * 1000 + 10000 // +10s
    )
    try {
      await addProfileItem(currentItem)
    } catch (e) {
      /* ignore */
    }
  }
}

export async function addProfileUpdater(item: IProfileItem): Promise<void> {
  if (item.type === 'remote' && item.interval) {
    // 跳过用户订阅占位URL（避免拉取无效订阅）
    if (
      item.id === USER_SUBSCRIPTION_ID &&
      (item.url === EMPTY_SUBSCRIPTION_URL || item.url === LOADING_SUBSCRIPTION_URL)
    ) {
      return
    }
    
    if (intervalPool[item.id]) {
      clearTimeout(intervalPool[item.id])
    }
    intervalPool[item.id] = setTimeout(
      async () => {
        try {
          await addProfileItem(item)
        } catch (e) {
          /* ignore */
        }
      },
      item.interval * 60 * 1000
    )
  }
}
