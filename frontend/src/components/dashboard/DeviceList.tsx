import { useState } from 'react'
import { useToast } from '../Toast'
import { deleteDevice } from '../../api/user'
import type { Device } from '../../types'

function platformIcon(platform?: string): string {
  const p = (platform ?? '').toLowerCase()
  if (p.includes('ios') || p.includes('iphone') || p.includes('ipad')) return '📱'
  if (p.includes('android')) return '📱'
  if (p.includes('windows')) return '💻'
  if (p.includes('mac') || p.includes('darwin')) return '💻'
  if (p.includes('linux')) return '💻'
  return '📟'
}

function formatLastSeen(lastSeen?: string): string {
  if (!lastSeen) return 'Неизвестно'
  try {
    const d = new Date(lastSeen)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return lastSeen
  }
}

interface ConfirmDialogProps {
  deviceLabel: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ deviceLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative glass rounded-[1.75rem] p-6 w-full max-w-sm shadow-2xl">
        <div className="text-base font-semibold text-white mb-2">Удалить устройство?</div>
        <div className="text-sm text-slate-300 mb-6">
          {deviceLabel} будет отключено от VPN немедленно.
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-2xl bg-rose-500/20 border border-rose-500/30 px-4 py-2.5 text-sm font-medium text-rose-200 hover:bg-rose-500/30 transition-colors"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>
  )
}

interface DeviceListProps {
  devices: Device[]
  user_service_id: number
  onDeleted: (hwid: string) => void
}

export default function DeviceList({ devices, user_service_id, onDeleted }: DeviceListProps) {
  const { show } = useToast()
  const [pendingHwid, setPendingHwid] = useState<string | null>(null)
  const [deletingHwid, setDeletingHwid] = useState<string | null>(null)

  const pendingDevice = devices.find(d => d.hwid === pendingHwid)
  const deviceLabel = pendingDevice?.deviceModel || pendingDevice?.platform || pendingDevice?.hwid || 'устройство'

  async function handleConfirmDelete() {
    if (!pendingHwid) return
    const hwid = pendingHwid
    setPendingHwid(null)
    setDeletingHwid(hwid)
    try {
      await deleteDevice(hwid, user_service_id)
      onDeleted(hwid)
      show('Устройство удалено', 'success')
    } catch {
      show('Не удалось удалить устройство', 'error')
    } finally {
      setDeletingHwid(null)
    }
  }

  if (devices.length === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-400">
        Нет активных устройств
      </div>
    )
  }

  return (
    <>
      {pendingHwid && (
        <ConfirmDialog
          deviceLabel={deviceLabel}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingHwid(null)}
        />
      )}
      <div className="mt-3 space-y-2">
        {devices.map(device => (
          <div
            key={device.hwid}
            className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3"
          >
            <span className="text-xl shrink-0">{platformIcon(device.platform)}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white truncate">
                {device.deviceModel || device.platform || 'Неизвестное устройство'}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Последнее подключение: {formatLastSeen(device.last_seen)}
              </div>
            </div>
            <button
              disabled={deletingHwid === device.hwid}
              onClick={() => setPendingHwid(device.hwid)}
              className="shrink-0 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deletingHwid === device.hwid ? '...' : 'Удалить'}
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
