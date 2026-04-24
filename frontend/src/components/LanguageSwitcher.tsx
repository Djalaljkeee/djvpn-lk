import { useTranslation } from 'react-i18next'

import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '../i18n'

interface Props {
  className?: string
}

export default function LanguageSwitcher({ className }: Props) {
  const { i18n, t } = useTranslation()
  const current = (i18n.resolvedLanguage ?? 'ru') as SupportedLanguage

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as SupportedLanguage
    if (SUPPORTED_LANGUAGES.includes(next)) {
      void i18n.changeLanguage(next)
    }
  }

  return (
    <label className={`flex items-center gap-2 text-xs text-slate-300 ${className ?? ''}`}>
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={current}
        onChange={handleChange}
        aria-label={t('common.language')}
        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng} className="bg-surface-0 text-white">
            {LANGUAGE_LABELS[lng]}
          </option>
        ))}
      </select>
    </label>
  )
}
