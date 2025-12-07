import { addProfileItem, getCurrentProfileItem, getProfileConfig } from '../config'

const intervalPool: Record<string, NodeJS.Timeout> = {}

export async function initProfileUpdater(): Promise<void> {
  const { items, current } = await getProfileConfig()
  const currentItem = await getCurrentProfileItem()
  
  const USER_SUBSCRIPTION_ID = 'user-subscription-meta'
  
  for (const item of items.filter((i) => i.id !== current)) {
    if (item.type === 'remote' && item.interval) {
      // 跳过用户订阅如果URL是空白占位URL（说明用户未登录）
      if (item.id === USER_SUBSCRIPTION_ID && item.url === 'https://example.com/empty-subscription') {
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
    // 跳过用户订阅如果URL是空白占位URL（说明用户未登录）
    if (currentItem.id === USER_SUBSCRIPTION_ID && currentItem.url === 'https://example.com/empty-subscription') {
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
    // 跳过用户订阅如果URL是空白占位URL（说明用户未登录）
    const USER_SUBSCRIPTION_ID = 'user-subscription-meta'
    if (item.id === USER_SUBSCRIPTION_ID && item.url === 'https://example.com/empty-subscription') {
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
