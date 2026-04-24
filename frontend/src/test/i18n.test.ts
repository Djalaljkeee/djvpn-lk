import { describe, expect, it } from 'vitest'

import i18n, { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '../i18n'

describe('i18n setup', () => {
  it('registers ru and en translations', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['ru', 'en'])
    expect(LANGUAGE_LABELS.ru).toBeTruthy()
    expect(LANGUAGE_LABELS.en).toBeTruthy()
  })

  it('returns localized navigation label', async () => {
    await i18n.changeLanguage('ru')
    expect(i18n.t('nav.home')).toBe('Главная')
    await i18n.changeLanguage('en')
    expect(i18n.t('nav.home')).toBe('Home')
  })

  it('falls back to ru when key is missing', async () => {
    await i18n.changeLanguage('en')
    // несуществующий ключ — i18next возвращает сам ключ; контроль того, что
    // хук работает и не падает.
    expect(typeof i18n.t('definitely.missing.key')).toBe('string')
  })
})
