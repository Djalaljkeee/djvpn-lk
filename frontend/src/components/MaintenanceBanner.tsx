import { useTranslation } from 'react-i18next'

import { useMaintenance } from '../hooks/useMaintenance'

export default function MaintenanceBanner() {
  const { enabled, message } = useMaintenance()
  const { t } = useTranslation()
  if (!enabled) return null

  return (
    <div
      role="status"
      className="sticky top-20 z-40 border-b border-amber-400/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-100 backdrop-blur"
    >
      {message || t('maintenance.banner')}
    </div>
  )
}
