import { useCallback, useEffect, useState } from 'react'
import { fetchTariffInfo, type TariffInfo } from '../api/tariffs'

/** Устройства и тип тарифа (base/family) из шаблона tariff_info.
 *  null — ещё не загрузилось или шаблона нет (старый SHM): UI тогда
 *  работает как раньше, без блока доп. устройств. */
export function useTariffInfo(usi: number | null | undefined, catalogIds: number[]) {
  const [info, setInfo] = useState<TariffInfo | null>(null)
  const idsKey = catalogIds.join(',')

  const reload = useCallback(async () => {
    if (!usi) { setInfo(null); return }
    try {
      setInfo(await fetchTariffInfo(usi, idsKey ? idsKey.split(',').map(Number) : []))
    } catch {
      setInfo(null)
    }
  }, [usi, idsKey])

  useEffect(() => { void reload() }, [reload])
  return { info, reload }
}
