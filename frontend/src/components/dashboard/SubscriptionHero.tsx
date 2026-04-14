import { Link } from 'react-router-dom'
import ParticleCanvas from '../ParticleCanvas'

export default function SubscriptionHero() {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-white/10 min-h-[340px] sm:min-h-[420px]">
      <div className="absolute inset-0">
        <ParticleCanvas className="opacity-80" />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(20,7,31,0.2) 0%, rgba(20,7,31,0.55) 50%, rgba(20,7,31,0.92) 100%)',
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-start justify-end h-full min-h-[340px] sm:min-h-[420px] p-6 sm:p-10">
        <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight">
          Оформить
          <br />
          новую подписку
        </h1>
        <p className="mt-4 max-w-md text-sm sm:text-base leading-6 text-slate-300">
          Испытай скорость вашего интернета на полную
        </p>
        <Link
          to="/services"
          className="mt-8 inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/5 backdrop-blur-sm px-8 py-4 text-sm font-semibold text-white hover:bg-white/10 hover:border-white/30 active:scale-[0.98] transition-all"
        >
          Оформить подписку
        </Link>
      </div>
    </section>
  )
}
