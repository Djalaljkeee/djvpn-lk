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
  return '🖥'
}

function shortHwid(hwid: string): string {
  return hwid.slice(-8).toUpperCase()
}

interface ConfirmDialogProps {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative glass rounded-[1.75rem] p-6 w-full max-w-sm shadow-2xl">
        <div className="text-base font-semibold text-white mb-2">Подтверждение</div>
        <div className="text-sm text-slate-300 mb-6">{message}</div>
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
  totalLimit?: number
  onDeleteAll?: () => Promise<void>
}

export default function DeviceList({ devices, user_service_id, onDeleted, totalLimit, onDeleteAll }: DeviceListProps) {
  const { show } = useToast()
  const [pendingHwid, setPendingHwid] = useState<string | null>(null)
  const [deletingHwid, setDeletingHwid] = useState<string | null>(null)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)

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

  async function handleConfirmDeleteAll() {
    setConfirmDeleteAll(false)
    if (!onDeleteAll) return
    setDeletingAll(true)
    try {
      await onDeleteAll()
      show('Все устройства удалены', 'success')
    } catch {
      show('Не удалось удалить все устройства', 'error')
    } finally {
      setDeletingAll(false)
    }
  }

  return (
    <>
      {pendingHwid && (
        <ConfirmDialog
          message={`«${deviceLabel}» будет отключено от VPN немедленно.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingHwid(null)}
        />
      )}
      {confirmDeleteAll && (
        <ConfirmDialog
          message={`Все ${devices.length} устройств будут отключены от VPN немедленно.`}
          onConfirm={handleConfirmDeleteAll}
          onCancel={() => setConfirmDeleteAll(false)}
        />
      )}

      {/* Header: count + delete-all */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-white">Мои устройства</div>
        <div className="flex items-center gap-3">
          {onDeleteAll && devices.length > 0 && (
            <button
              onClick={() => setConfirmDeleteAll(true)}
              disabled={deletingAll}
              className="text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors disabled:opacity-40"
            >
              {deletingAll ? 'Удаляем…' : 'Удалить все'}
            </button>
          )}
        </div>
      </div>

      {/* Subheader count */}
      <div className="text-xs text-slate-400 mb-3">
        {totalLimit !== undefined ? (
          <>
            <span className={devices.length > totalLimit ? 'font-semibold text-rose-400' : 'text-white'}>
              {devices.length}
            </span>
            {' / '}
            {totalLimit} устройства
          </>
        ) : (
          <>{devices.length} / 5 устройства</>
        )}
      </div>

      {devices.length === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-400">
          Нет активных устройств
        </div>
      ) : (
        <div className="space-y-2">
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
                  {[device.platform, shortHwid(device.hwid)].filter(Boolean).join(' ')}
                </div>
              </div>
              <button
                disabled={deletingHwid === device.hwid}
                onClick={() => setPendingHwid(device.hwid)}
                className="shrink-0 rounded-xl p-2 text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deletingHwid === device.hwid ? (
                  <span className="h-4 w-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin inline-block" />
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
