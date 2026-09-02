import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { FAQ_CATEGORIES, FAQ_ITEMS, searchFaq } from '../data/faq'
import FaqPage from '../pages/FaqPage'
import i18n from '../i18n'

describe('faq data', () => {
  it('has unique ids', () => {
    const ids = FAQ_ITEMS.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every item has a question, an answer and a known category', () => {
    for (const item of FAQ_ITEMS) {
      expect(item.q.trim().length, item.id).toBeGreaterThan(0)
      expect(item.a.length, item.id).toBeGreaterThan(0)
      expect(item.a.every(p => p.trim().length > 0), item.id).toBe(true)
      expect(FAQ_CATEGORIES, item.id).toContain(item.category)
    }
  })

  it('every category is represented', () => {
    for (const c of FAQ_CATEGORIES) {
      expect(FAQ_ITEMS.some(i => i.category === c), c).toBe(true)
    }
  })

  // Ссылки уходят в внешние вкладки, http/подделанные схемы там не нужны.
  // tg: — исключение: диплинк прокси Telegram открывается клиентом.
  it('links use https or the telegram deeplink scheme', () => {
    for (const item of FAQ_ITEMS) {
      for (const link of item.links ?? []) {
        expect(link.href.startsWith('https://') || link.href.startsWith('tg://'), item.id).toBe(true)
        expect(link.label.trim().length, item.id).toBeGreaterThan(0)
      }
    }
  })
})

describe('searchFaq', () => {
  it('returns everything for an empty query', () => {
    expect(searchFaq(FAQ_ITEMS, '   ')).toHaveLength(FAQ_ITEMS.length)
  })

  it('requires ALL words to match, not any', () => {
    // «не» встречается почти везде — по одному общему слову выдача не должна
    // раздуваться до половины базы.
    const both = searchFaq(FAQ_ITEMS, 'не работает ютуб')
    expect(both.length).toBeGreaterThan(0)
    expect(both.map(i => i.id)).toContain('youtube')
    expect(both.length).toBeLessThan(searchFaq(FAQ_ITEMS, 'не').length)
  })

  it('matches by word start, not by substring', () => {
    // Иначе «он» находит «телефон», «раб» — «работа» и половину базы.
    expect(searchFaq(FAQ_ITEMS, 'лефон')).toHaveLength(0)
  })

  it('maps the words users actually type to the words in the answers', () => {
    // Самый частый запрос переписки. В текстах ответов стоит латинское VPN.
    expect(searchFaq(FAQ_ITEMS, 'не работает впн').length).toBeGreaterThan(0)
    expect(searchFaq(FAQ_ITEMS, 'не работает тг').map(i => i.id)).toContain('tg-proxy')
  })

  it('finds the right entry for the questions support gets most often', () => {
    // Замер на живых формулировках из переписки: любая правка данных или
    // поиска, после которой запрос перестаёт находить свой ответ, — регресс.
    const expected: Record<string, string> = {
      'не работает впн': 'vpn-not-working',
      'возврат денег': 'refund',
      'сколько устройств': 'device-limit',
      'не работает ютуб': 'youtube',
      'не работает на мобильном интернете': 'mobile-whitelists',
      'подключить телевизор': 'tv-setup',
      'приложение не скачивается': 'appstore-region',
      'как добавить второе устройство': 'add-device',
      'медленно работает': 'slow',
      'белая страница при оплате': 'payment-page-broken',
      'сменить тариф': 'change-tariff',
      'отвязать карту': 'autopay',
      'пробный период': 'trial',
      'не работает инстаграм': 'messengers',
      'не могу зайти в кабинет': 'lk-access',
      'ошибка кора': 'which-reset',
      'обновить подписку': 'update-subscription',
      'прокси для телеграм': 'tg-proxy',
      'лимит трафика': 'traffic-limit',
      'смена региона апстор': 'appstore-region',
      'не приходит оплата': 'paid-not-activated',
      'сколько стоит': 'how-to-pay',
      'бонусы за друзей': 'referral-program',
      'как поделиться подпиской': 'add-device',
      'удалить аккаунт': 'delete-account',
      'ps5': 'console-proxy',
      'сбросить настройки': 'reset-app',
    }
    for (const [query, id] of Object.entries(expected)) {
      expect(searchFaq(FAQ_ITEMS, query).map(i => i.id), query).toContain(id)
    }
  })

  it('ignores case and ё', () => {
    const withYo = searchFaq(FAQ_ITEMS, 'Ещё одно устройство')
    const withoutYo = searchFaq(FAQ_ITEMS, 'еще одно устройство')
    expect(withoutYo.map(i => i.id)).toEqual(withYo.map(i => i.id))
    expect(withoutYo.length).toBeGreaterThan(0)
  })

  it('matches user wording kept in tags, not only the answer text', () => {
    // «слетело» нет ни в одном вопросе — только в тегах записи про сброс.
    const found = searchFaq(FAQ_ITEMS, 'слетело')
    expect(found.map(i => i.id)).toContain('reset-app')
  })

  it('returns nothing for gibberish', () => {
    expect(searchFaq(FAQ_ITEMS, 'йцукенгшщз')).toHaveLength(0)
  })
})

describe('FaqPage', () => {
  const renderPage = () => render(<MemoryRouter><FaqPage /></MemoryRouter>)

  it('renders every question collapsed, answers hidden until asked', async () => {
    await i18n.changeLanguage('ru')
    renderPage()
    expect(screen.getAllByRole('button', { expanded: false }).length).toBeGreaterThan(10)
    expect(screen.queryByText(/Ссылка на подписку у вас постоянная/)).not.toBeInTheDocument()
  })

  it('opens an answer on click', async () => {
    await i18n.changeLanguage('ru')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Мне нужно установить новый ключ/ }))
    expect(screen.getByText(/Ссылка на подписку у вас постоянная/)).toBeInTheDocument()
  })

  it('narrows the list as you type', async () => {
    await i18n.changeLanguage('ru')
    renderPage()
    const before = screen.getAllByRole('button', { expanded: false }).length
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'возврат денег' } })
    const after = screen.getAllByRole('button', { expanded: false }).length
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThan(0)
  })

  it('offers support when nothing matches', async () => {
    await i18n.changeLanguage('ru')
    renderPage()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'йцукенгшщз' } })
    expect(screen.getByText(/ничего не нашлось/i)).toBeInTheDocument()
  })
})
